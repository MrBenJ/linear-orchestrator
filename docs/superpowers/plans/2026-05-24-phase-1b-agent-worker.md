# Phase 1b: Agent Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make queued runs actually execute — a separate `lo-worker` process claims a queued run, creates a git worktree, spawns a `claude-code` agent via `node-pty`, captures its output, enforces a concurrency cap + timeout/heartbeat, and reacts to the agent's status/heartbeat/cancel callbacks (including driving the Linear ticket on completion).

**Architecture:** A long-lived worker loop (`tsx src/worker/index.ts`, separate from Next.js) polls SQLite for queued runs and supervises agent child processes through `node-pty`. Core logic (spawn, reaper, claim) takes injected dependencies — a PTY spawner, a worktree creator, and a clock — so it is unit-testable without spawning real `claude-code` or real processes. The agent calls back over HTTP to `/api/runs/:id/{complete,heartbeat}`; an operator cancels via `/api/runs/:id/cancel`.

**Tech Stack:** TypeScript, node-pty, better-sqlite3 + drizzle-orm, @linear/sdk (via the existing `LinearGateway`), Vitest, tsx, concurrently.

**Spec:** `docs/superpowers/specs/2026-05-22-phase-1-lo-core-and-agent-runner-design.md`

**Builds on 1a (merged):** `getDb()`/`DB` (`src/db/client.ts`), schema `tickets`/`runs`/`agentLogs`/`configRow` (`src/db/schema.ts`), `getConfig()`/`resolveStateMap` (`src/config`), `LinearGateway` + `getLinearGateway()` + `FakeLinearGateway` (`src/linear`), `createTicketAndRun`/`getRun` (`src/runs/service.ts`), `makeTestDb`/`makeTestConfig` (`test/helpers`).

**Scope of 1b:** node-pty dependency · worktree manager · prompt template · run-service lifecycle (+ `cancel_requested` column) · agent-log read/write · `POST /api/runs/:id/{complete,heartbeat,cancel}` · `GET /api/runs` + `GET /api/runs/:id` + `GET /api/runs/:id/logs` · PTY spawner + spawnAgent · reaper · worker loop · `bin/lo.ts` CLI (status/logs/kill/config).

**Deferred to 1c:** GitHub PR-merge webhook + `done` on later human-merge, `lo linear bootstrap`/`lo linear states`, full live-server echo-agent E2E, smoke-test doc.

---

## File structure (created/modified by this plan)

```
package.json                         (modify: deps + scripts)
pnpm-workspace.yaml                  (modify: allowBuilds node-pty)
src/db/schema.ts                     (modify: add cancel_requested)
drizzle/                             (new generated migration)
src/runs/service.ts                  (modify: lifecycle fns)
src/runs/logs.ts                     (new: append/read agent logs)
src/worker/promptTemplate.ts         (new)
src/worker/agentEnv.ts               (new: token + env builder)
src/worker/pty.ts                    (new: PtySpawner interface + node-pty impl)
src/worker/spawnAgent.ts             (new: supervise one agent)
src/worker/reaper.ts                 (new: timeout/heartbeat/cancel/completed)
src/worker/index.ts                  (new: the loop)
src/linear/ticketActions.ts          (new: drive Linear from a run outcome)
src/app/api/runs/route.ts            (new: GET list)
src/app/api/runs/[id]/route.ts       (new: GET one)
src/app/api/runs/[id]/logs/route.ts  (new: GET logs)
src/app/api/runs/[id]/complete/{handler,route}.ts   (new)
src/app/api/runs/[id]/heartbeat/{handler,route}.ts  (new)
src/app/api/runs/[id]/cancel/{handler,route}.ts     (new)
bin/lo.ts                            (new: CLI)
test/helpers/tempRepo.ts             (new: temp git repo for worktree tests)
test/helpers/fakePty.ts              (new: PtySpawner test double)
```

---

## Task 1: node-pty + concurrently dependency

**Files:**
- Modify: `package.json`, `pnpm-workspace.yaml`

- [ ] **Step 1: Add dependencies to `package.json`**

Add to `dependencies`:
```json
    "node-pty": "^1.0.0",
```
Add to `devDependencies`:
```json
    "concurrently": "^9.1.0",
```

- [ ] **Step 2: Add worker/CLI scripts to `package.json` `scripts`**

```json
    "worker": "tsx src/worker/index.ts",
    "dev:web": "next dev",
    "dev:worker": "tsx watch src/worker/index.ts",
    "dev:all": "concurrently -n web,worker -c blue,magenta \"pnpm dev:web\" \"pnpm dev:worker\"",
    "lo": "tsx bin/lo.ts",
```

- [ ] **Step 3: Allow the node-pty native build under pnpm 11**

Edit `pnpm-workspace.yaml` to add `node-pty: true` under `allowBuilds:`:
```yaml
allowBuilds:
  better-sqlite3: true
  esbuild: true
  node-pty: true
  sharp: false
```

- [ ] **Step 4: Install and build the native module**

Run: `pnpm install && pnpm rebuild node-pty`
Expected: completes; node-pty compiles a native binding.

- [ ] **Step 5: Verify node-pty loads and round-trips a process**

Run:
```bash
node -e "const pty=require('node-pty'); const p=pty.spawn(process.execPath,['-e','process.stdout.write(\"ok\")'],{cwd:process.cwd(),env:process.env}); let out=''; p.onData(d=>out+=d); p.onExit(e=>{console.log('exit',e.exitCode,'saw:',out.includes('ok')); });"
```
Expected: prints `exit 0 saw: true`.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: add node-pty and concurrently; worker/cli scripts"
```

---

## Task 2: `cancel_requested` column + migration

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/` migration (generated)
- Test: `src/db/cancelColumn.test.ts`

- [ ] **Step 1: Write the failing test** in `src/db/cancelColumn.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../test/helpers/testDb";
import { tickets, runs } from "./schema";

describe("runs.cancelRequested", () => {
  it("defaults to 0 and can be set to 1", () => {
    const db = makeTestDb();
    db.insert(tickets).values({
      id: "t1", linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
      linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p",
      metadata: null, createdAt: 1,
    }).run();
    db.insert(runs).values({ id: "r1", ticketId: "t1", status: "running", createdAt: 1 }).run();

    const before = db.select().from(runs).where(eq(runs.id, "r1")).get();
    expect(before?.cancelRequested).toBe(0);

    db.update(runs).set({ cancelRequested: 1 }).where(eq(runs.id, "r1")).run();
    const after = db.select().from(runs).where(eq(runs.id, "r1")).get();
    expect(after?.cancelRequested).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/db/cancelColumn.test.ts`
Expected: FAIL — `cancelRequested` is not a column yet (TS error or undefined).

- [ ] **Step 3: Add the column** in `src/db/schema.ts` — inside the `runs` table, after `callbackToken`:

```ts
  callbackToken: text("callback_token"),
  cancelRequested: integer("cancel_requested").notNull().default(0),
  createdAt: integer("created_at").notNull(),
```

- [ ] **Step 4: Generate the migration**

Run: `pnpm db:generate`
Expected: a new `drizzle/0001_*.sql` adding `cancel_requested`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/db/cancelColumn.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/cancelColumn.test.ts drizzle
git commit -m "feat: add runs.cancel_requested column for operator cancellation"
```

---

## Task 3: Agent-log append/read helpers

**Files:**
- Create: `src/runs/logs.ts`
- Test: `src/runs/logs.test.ts`

- [ ] **Step 1: Write the failing test** in `src/runs/logs.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import { tickets, runs } from "@/db/schema";
import { appendLog, readLogs } from "./logs";

function seedRun(db: ReturnType<typeof makeTestDb>) {
  db.insert(tickets).values({
    id: "t1", linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p",
    metadata: null, createdAt: 1,
  }).run();
  db.insert(runs).values({ id: "r1", ticketId: "t1", status: "running", createdAt: 1 }).run();
}

describe("agent logs", () => {
  it("appends ordered chunks and reads them back as text", () => {
    const db = makeTestDb();
    seedRun(db);
    appendLog(db, "r1", 0, "stdout", Buffer.from("hello "));
    appendLog(db, "r1", 1, "stdout", Buffer.from("world"));

    const all = readLogs(db, "r1");
    expect(all.map((l) => l.text).join("")).toBe("hello world");
    expect(all.map((l) => l.seq)).toEqual([0, 1]);
  });

  it("reads only chunks at or after a given seq", () => {
    const db = makeTestDb();
    seedRun(db);
    appendLog(db, "r1", 0, "stdout", Buffer.from("a"));
    appendLog(db, "r1", 1, "stdout", Buffer.from("b"));
    appendLog(db, "r1", 2, "stdout", Buffer.from("c"));

    const tail = readLogs(db, "r1", 1);
    expect(tail.map((l) => l.text).join("")).toBe("bc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/runs/logs.test.ts`
Expected: FAIL — `Cannot find module './logs'`.

- [ ] **Step 3: Create `src/runs/logs.ts`**

```ts
import { and, eq, gte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { agentLogs } from "@/db/schema";

export type LogStream = "stdout" | "stderr";

export interface LogChunk {
  seq: number;
  ts: number;
  stream: LogStream;
  text: string;
}

export function appendLog(
  db: DB,
  runId: string,
  seq: number,
  stream: LogStream,
  chunk: Buffer,
): void {
  db.insert(agentLogs)
    .values({ runId, seq, ts: Date.now(), stream, chunk })
    .run();
}

export function readLogs(db: DB, runId: string, fromSeq = 0): LogChunk[] {
  const rows = db
    .select()
    .from(agentLogs)
    .where(and(eq(agentLogs.runId, runId), gte(agentLogs.seq, fromSeq)))
    .orderBy(agentLogs.seq)
    .all();
  return rows.map((r) => ({
    seq: r.seq,
    ts: r.ts,
    stream: r.stream as LogStream,
    text: Buffer.from(r.chunk as Buffer).toString("utf8"),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/runs/logs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runs/logs.ts src/runs/logs.test.ts
git commit -m "feat: add agent-log append/read helpers"
```

---

## Task 4: Run-service lifecycle functions

**Files:**
- Modify: `src/runs/service.ts`
- Test: `src/runs/lifecycle.test.ts`

- [ ] **Step 1: Write the failing test** in `src/runs/lifecycle.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import { createTicketAndRun } from "./service";
import {
  claimNextQueuedRun,
  setWorktree,
  markRunning,
  touchHeartbeat,
  requestCancel,
  markTerminal,
  recordPrLinkage,
  getRunWithTicket,
  listRuns,
} from "./service";

function seed(db: ReturnType<typeof makeTestDb>, issue: string) {
  return createTicketAndRun(db, {
    linearIssueId: issue, linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: "proj-1", repoPath: "/tmp/r", harness: "claude-code",
    prompt: "p", metadata: null,
  });
}

describe("run lifecycle", () => {
  it("claims the oldest queued run exactly once and marks it running", () => {
    const db = makeTestDb();
    const a = seed(db, "i1");
    const b = seed(db, "i2");

    const first = claimNextQueuedRun(db);
    expect(first?.id).toBe(a.runId);
    expect(first?.status).toBe("running");

    const second = claimNextQueuedRun(db);
    expect(second?.id).toBe(b.runId);

    expect(claimNextQueuedRun(db)).toBeUndefined();
  });

  it("records worktree, pid, heartbeat, and terminal state", () => {
    const db = makeTestDb();
    const { runId } = seed(db, "i1");
    claimNextQueuedRun(db);
    setWorktree(db, runId, "/wt/r1", "lo/ENG-1-abc");
    markRunning(db, runId, 4321);
    touchHeartbeat(db, runId);

    const { run } = getRunWithTicket(db, runId)!;
    expect(run.worktreePath).toBe("/wt/r1");
    expect(run.pid).toBe(4321);
    expect(run.lastHeartbeatAt).toBeGreaterThan(0);

    markTerminal(db, runId, "completed", { exitCode: 0 });
    const after = getRunWithTicket(db, runId)!.run;
    expect(after.status).toBe("completed");
    expect(after.completedAt).toBeGreaterThan(0);
  });

  it("records PR linkage and parses the PR number from the URL", () => {
    const db = makeTestDb();
    const { runId } = seed(db, "i1");
    recordPrLinkage(db, runId, "https://github.com/o/r/pull/42", "merged");
    const { run } = getRunWithTicket(db, runId)!;
    expect(run.prNumber).toBe(42);
    expect(run.prState).toBe("merged");
  });

  it("flags cancellation and lists active runs", () => {
    const db = makeTestDb();
    const { runId } = seed(db, "i1");
    claimNextQueuedRun(db);
    expect(requestCancel(db, runId)).toBe(true);
    expect(getRunWithTicket(db, runId)!.run.cancelRequested).toBe(1);

    const active = listRuns(db);
    expect(active.find((r) => r.id === runId)).toBeTruthy();
  });

  it("joins the run to its ticket", () => {
    const db = makeTestDb();
    const { runId } = seed(db, "i1");
    const joined = getRunWithTicket(db, runId)!;
    expect(joined.ticket.linearIssueId).toBe("i1");
    expect(joined.ticket.linearTeamId).toBe("team-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/runs/lifecycle.test.ts`
Expected: FAIL — the new functions are not exported.

- [ ] **Step 3: Append lifecycle functions to `src/runs/service.ts`**

Add these imports at the top (merge with the existing `drizzle-orm` import):

```ts
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import { tickets, runs } from "@/db/schema";
```

Append:

```ts
export type RunRow = typeof runs.$inferSelect;
export type TicketRow = typeof tickets.$inferSelect;
export interface RunWithTicket {
  run: RunRow;
  ticket: TicketRow;
}

export type TerminalStatus = "completed" | "failed" | "timed_out" | "cancelled";

/** Atomically move the oldest queued run to running and return it. */
export function claimNextQueuedRun(db: DB): RunRow | undefined {
  return db.transaction((tx) => {
    const next = tx
      .select()
      .from(runs)
      .where(eq(runs.status, "queued"))
      .orderBy(asc(runs.createdAt))
      .limit(1)
      .get();
    if (!next) return undefined;
    const startedAt = Date.now();
    tx.update(runs).set({ status: "running", startedAt }).where(eq(runs.id, next.id)).run();
    return { ...next, status: "running", startedAt };
  });
}

export function setWorktree(db: DB, runId: string, worktreePath: string, branchName: string): void {
  db.update(runs).set({ worktreePath, branchName }).where(eq(runs.id, runId)).run();
}

export function markRunning(db: DB, runId: string, pid: number): void {
  db.update(runs).set({ pid }).where(eq(runs.id, runId)).run();
}

export function touchHeartbeat(db: DB, runId: string): void {
  db.update(runs).set({ lastHeartbeatAt: Date.now() }).where(eq(runs.id, runId)).run();
}

export function requestCancel(db: DB, runId: string): boolean {
  const res = db.update(runs).set({ cancelRequested: 1 }).where(eq(runs.id, runId)).run();
  return res.changes > 0;
}

export interface TerminalFields {
  exitCode?: number | null;
  failureReason?: string | null;
  result?: unknown;
}

export function markTerminal(
  db: DB,
  runId: string,
  status: TerminalStatus,
  fields: TerminalFields = {},
): void {
  db.update(runs)
    .set({
      status,
      completedAt: Date.now(),
      exitCode: fields.exitCode ?? null,
      failureReason: fields.failureReason ?? null,
      result: fields.result === undefined ? null : JSON.stringify(fields.result),
    })
    .where(eq(runs.id, runId))
    .run();
}

export function recordPrLinkage(
  db: DB,
  runId: string,
  prUrl: string,
  prState: "open" | "merged",
): void {
  const match = prUrl.match(/\/pull\/(\d+)/);
  const prNumber = match ? Number(match[1]) : null;
  db.update(runs).set({ prUrl, prNumber, prState }).where(eq(runs.id, runId)).run();
}

export function getRunWithTicket(db: DB, runId: string): RunWithTicket | undefined {
  const run = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (!run) return undefined;
  const ticket = db.select().from(tickets).where(eq(tickets.id, run.ticketId)).get();
  if (!ticket) return undefined;
  return { run, ticket };
}

/** Active (non-terminal) runs, newest first. */
export function listRuns(db: DB): RunRow[] {
  return db
    .select()
    .from(runs)
    .where(inArray(runs.status, ["queued", "running"]))
    .orderBy(asc(runs.createdAt))
    .all();
}

export function countRunning(db: DB): number {
  return db.select().from(runs).where(eq(runs.status, "running")).all().length;
}
```

> Note: the file already imports `randomUUID`, `eq`, `DB`, `tickets`, and `runs` for `createTicketAndRun`. Do not duplicate imports — extend the existing import lines to include `asc` and `inArray`, and reuse the existing `randomUUID`/`DB`/table imports.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/runs/lifecycle.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite to confirm no regression in existing run-service tests**

Run: `pnpm test src/runs`
Expected: PASS (lifecycle + existing service tests).

- [ ] **Step 6: Commit**

```bash
git add src/runs/service.ts src/runs/lifecycle.test.ts
git commit -m "feat: add run lifecycle (claim, running, heartbeat, terminal, pr, cancel)"
```

---

## Task 5: Prompt template

**Files:**
- Create: `src/worker/promptTemplate.ts`
- Test: `src/worker/promptTemplate.test.ts`

- [ ] **Step 1: Write the failing test** in `src/worker/promptTemplate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { composeAgentPrompt } from "./promptTemplate";

describe("composeAgentPrompt", () => {
  const base = {
    userPrompt: "Implement foo in foo.ts.",
    repoPath: "/repo",
    worktreePath: "/wt/r1",
    branchName: "lo/ENG-1-abc",
    linearUrl: "https://linear.app/x/issue/ENG-1",
    acceptanceCriteria: ["foo works", "tests pass"],
    callbackUrl: "http://localhost:3000/api/runs/r1",
  };

  it("keeps the user prompt as the leading content", () => {
    const out = composeAgentPrompt(base);
    expect(out.startsWith("Implement foo in foo.ts.")).toBe(true);
  });

  it("appends operational context and the code-task + callback instructions", () => {
    const out = composeAgentPrompt(base);
    expect(out).toContain("/wt/r1");
    expect(out).toContain("lo/ENG-1-abc");
    expect(out).toContain("https://linear.app/x/issue/ENG-1");
    expect(out).toContain("- foo works");
    expect(out).toContain("/code-task");
    expect(out).toContain("http://localhost:3000/api/runs/r1/complete");
    expect(out).toContain("http://localhost:3000/api/runs/r1/heartbeat");
    expect(out).toContain("prMerged");
  });

  it("omits the acceptance-criteria block when there are none", () => {
    const out = composeAgentPrompt({ ...base, acceptanceCriteria: [] });
    expect(out).not.toContain("Acceptance criteria:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/worker/promptTemplate.test.ts`
Expected: FAIL — `Cannot find module './promptTemplate'`.

- [ ] **Step 3: Create `src/worker/promptTemplate.ts`**

```ts
export interface PromptContext {
  userPrompt: string;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  linearUrl: string;
  acceptanceCriteria: string[];
  callbackUrl: string;
}

export function composeAgentPrompt(ctx: PromptContext): string {
  const acBlock =
    ctx.acceptanceCriteria.length > 0
      ? ["Acceptance criteria:", ...ctx.acceptanceCriteria.map((a) => `- ${a}`)].join("\n")
      : "";

  const footer = [
    "---",
    "[LO orchestrator context]",
    `- Target repo: ${ctx.repoPath}`,
    `- Worktree (your CWD): ${ctx.worktreePath}`,
    `- Feature branch: ${ctx.branchName} (already checked out)`,
    `- Linear ticket: ${ctx.linearUrl}`,
    acBlock,
    "",
    "When implementation is complete, invoke the /code-task skill to drive your work",
    "to a reviewed, merged PR. /code-task handles PR creation, code review with Aria,",
    "iteration on feedback, and merge.",
    "",
    `After /code-task finishes, POST to ${ctx.callbackUrl}/complete with header`,
    `Authorization: Bearer <LO_CALLBACK_TOKEN> and JSON body:`,
    `  { "status": "success" | "failure", "prUrl": "...", "prMerged": true | false,`,
    `    "summary": "...", "notes": "..." }`,
    "Set prMerged:true only if the PR is actually merged.",
    "",
    `While working, POST every ~5 minutes to ${ctx.callbackUrl}/heartbeat with the same`,
    "Authorization header (empty body).",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return `${ctx.userPrompt}\n\n${footer}\n`;
}
```

> Note: the `.filter((line) => line !== "")` drops intentional blank lines; that is fine — the test only checks for substring presence, and the agent reads this as plain instructions. Keep `acBlock` empty-string filtered out so no stray "Acceptance criteria:" header appears when there are none.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/worker/promptTemplate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/promptTemplate.ts src/worker/promptTemplate.test.ts
git commit -m "feat: add agent prompt template (user prompt + LO footer)"
```

---

## Task 6: Linear ticket actions (drive Linear from a run outcome)

**Files:**
- Create: `src/linear/ticketActions.ts`
- Test: `src/linear/ticketActions.test.ts`

- [ ] **Step 1: Write the failing test** in `src/linear/ticketActions.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { FakeLinearGateway } from "../../test/helpers/fakeLinear";
import { applyRunOutcome } from "./ticketActions";

const stateMap = { inProgress: "s-prog", inReview: "s-rev", done: "s-done" };

describe("applyRunOutcome", () => {
  it("transitions to done on a merged success", async () => {
    const linear = new FakeLinearGateway();
    await applyRunOutcome(linear, {
      issueId: "i1", teamId: "team-1", stateMap, needsHumanLabel: "lo:needs-human",
      outcome: { status: "success", prMerged: true },
    });
    expect(linear.stateUpdates).toEqual([{ issueId: "i1", stateId: "s-done" }]);
  });

  it("transitions to inReview on a non-merged success", async () => {
    const linear = new FakeLinearGateway();
    await applyRunOutcome(linear, {
      issueId: "i1", teamId: "team-1", stateMap, needsHumanLabel: "lo:needs-human",
      outcome: { status: "success", prMerged: false },
    });
    expect(linear.stateUpdates).toEqual([{ issueId: "i1", stateId: "s-rev" }]);
  });

  it("labels needs-human and comments on failure, without a state change", async () => {
    const linear = new FakeLinearGateway();
    await applyRunOutcome(linear, {
      issueId: "i1", teamId: "team-1", stateMap, needsHumanLabel: "lo:needs-human",
      outcome: { status: "failure", summary: "it broke", notes: "stack trace" },
    });
    expect(linear.stateUpdates).toEqual([]);
    expect(linear.labelAdds).toEqual([{ issueId: "i1", labelId: "label-lo:needs-human" }]);
    expect(linear.comments).toHaveLength(1);
    expect(linear.comments[0].body).toContain("it broke");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/linear/ticketActions.test.ts`
Expected: FAIL — `Cannot find module './ticketActions'`.

- [ ] **Step 3: Create `src/linear/ticketActions.ts`**

```ts
import type { LinearGateway } from "./gateway";
import type { StateMap } from "@/config/types";

export interface RunOutcome {
  status: "success" | "failure";
  prUrl?: string;
  prMerged?: boolean;
  summary?: string;
  notes?: string;
}

export interface ApplyOutcomeInput {
  issueId: string;
  teamId: string;
  stateMap: StateMap;
  needsHumanLabel: string;
  outcome: RunOutcome;
}

export async function applyRunOutcome(linear: LinearGateway, input: ApplyOutcomeInput): Promise<void> {
  const { issueId, teamId, stateMap, needsHumanLabel, outcome } = input;

  if (outcome.status === "success") {
    const stateId = outcome.prMerged ? stateMap.done : stateMap.inReview;
    await linear.updateIssueState(issueId, stateId);
    return;
  }

  // Failure: label needs-human and comment; leave the workflow state untouched.
  const labelId = await linear.ensureLabel(teamId, needsHumanLabel);
  await linear.addLabelToIssue(issueId, labelId);
  const body = [outcome.summary, outcome.notes].filter(Boolean).join("\n\n") || "Run failed.";
  await linear.createComment(issueId, body);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/linear/ticketActions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/linear/ticketActions.ts src/linear/ticketActions.test.ts
git commit -m "feat: add applyRunOutcome to drive Linear from a run result"
```

---

## Task 7: `POST /api/runs/:id/complete`

**Files:**
- Create: `src/app/api/runs/[id]/complete/handler.ts`, `src/app/api/runs/[id]/complete/route.ts`
- Test: `src/app/api/runs/[id]/complete/handler.test.ts`

- [ ] **Step 1: Write the failing test** in `src/app/api/runs/[id]/complete/handler.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { handleComplete } from "./handler";
import { makeTestDb } from "../../../../../../test/helpers/testDb";
import { makeTestConfig } from "../../../../../../test/helpers/testConfig";
import { FakeLinearGateway } from "../../../../../../test/helpers/fakeLinear";
import { createTicketAndRun, claimNextQueuedRun, getRunWithTicket } from "@/runs/service";
import { runs } from "@/db/schema";
import { eq } from "drizzle-orm";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "issue-1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: "proj-1", repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  db.update(runs).set({ callbackToken: "tok" }).where(eq(runs.id, runId)).run();
  return { db, runId, config: makeTestConfig(), linear: new FakeLinearGateway() };
}

function req(token: string | null, body: unknown): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/runs/r/complete", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("handleComplete", () => {
  it("rejects a bad callback token with 401", async () => {
    const { db, runId, config, linear } = setup();
    const res = await handleComplete(req("wrong", { status: "success", prMerged: true }), runId, { db, config, linear });
    expect(res.status).toBe(401);
  });

  it("marks completed and transitions to done on a merged success", async () => {
    const { db, runId, config, linear } = setup();
    const res = await handleComplete(
      req("tok", { status: "success", prUrl: "https://github.com/o/r/pull/7", prMerged: true }),
      runId,
      { db, config, linear },
    );
    expect(res.status).toBe(200);
    const { run } = getRunWithTicket(db, runId)!;
    expect(run.status).toBe("completed");
    expect(run.prNumber).toBe(7);
    expect(run.prState).toBe("merged");
    expect(linear.stateUpdates).toEqual([{ issueId: "issue-1", stateId: "s-done" }]);
  });

  it("marks failed and labels needs-human on failure", async () => {
    const { db, runId, config, linear } = setup();
    const res = await handleComplete(
      req("tok", { status: "failure", summary: "boom" }),
      runId,
      { db, config, linear },
    );
    expect(res.status).toBe(200);
    expect(getRunWithTicket(db, runId)!.run.status).toBe("failed");
    expect(linear.labelAdds).toEqual([{ issueId: "issue-1", labelId: "label-lo:needs-human" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/runs/\[id\]/complete/handler.test.ts`
Expected: FAIL — `Cannot find module './handler'`.

- [ ] **Step 3: Create `src/app/api/runs/[id]/complete/handler.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { resolveStateMap } from "@/config";
import type { LinearGateway } from "@/linear/gateway";
import { applyRunOutcome } from "@/linear/ticketActions";
import { getRunWithTicket, markTerminal, recordPrLinkage } from "@/runs/service";

const bodySchema = z.object({
  status: z.enum(["success", "failure"]),
  prUrl: z.string().optional(),
  prMerged: z.boolean().optional(),
  summary: z.string().optional(),
  notes: z.string().optional(),
});

export interface CompleteDeps {
  db: DB;
  config: Config;
  linear: LinearGateway;
}

function bearerEquals(header: string | null, token: string | null): boolean {
  if (!header || !token) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleComplete(req: Request, runId: string, deps: CompleteDeps): Promise<Response> {
  const joined = getRunWithTicket(deps.db, runId);
  if (!joined) return new Response("run not found", { status: 404 });
  if (!bearerEquals(req.headers.get("authorization"), joined.run.callbackToken)) {
    return new Response("unauthorized", { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return new Response(JSON.stringify(parsed.error.flatten()), { status: 400 });
  const body = parsed.data;

  // Persist run result + PR linkage first (durable), then drive Linear.
  if (body.prUrl) recordPrLinkage(deps.db, runId, body.prUrl, body.prMerged ? "merged" : "open");
  markTerminal(deps.db, runId, body.status === "success" ? "completed" : "failed", {
    result: body,
  });

  const stateMap = resolveStateMap(deps.config, joined.ticket.linearTeamId);
  if (stateMap) {
    await applyRunOutcome(deps.linear, {
      issueId: joined.ticket.linearIssueId,
      teamId: joined.ticket.linearTeamId,
      stateMap,
      needsHumanLabel: deps.config.orchestrationLabels.needsHuman,
      outcome: body,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/runs/\[id\]/complete/handler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the route adapter** `src/app/api/runs/[id]/complete/route.ts`

```ts
import { handleComplete } from "./handler";
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getLinearGateway } from "@/linear/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handleComplete(req, id, { db: getDb(), config: getConfig(), linear: getLinearGateway() });
}
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS. (Next 15 route handlers receive `params` as a Promise — note the `await params`.)

- [ ] **Step 7: Commit**

```bash
git add src/app/api/runs/\[id\]/complete
git commit -m "feat: add POST /api/runs/:id/complete with Linear outcome driving"
```

---

## Task 8: `POST /api/runs/:id/heartbeat` and `POST /api/runs/:id/cancel`

**Files:**
- Create: `src/app/api/runs/[id]/heartbeat/handler.ts`, `.../heartbeat/route.ts`
- Create: `src/app/api/runs/[id]/cancel/handler.ts`, `.../cancel/route.ts`
- Test: `src/app/api/runs/[id]/heartbeat/handler.test.ts`, `src/app/api/runs/[id]/cancel/handler.test.ts`

- [ ] **Step 1: Write the failing heartbeat test** in `src/app/api/runs/[id]/heartbeat/handler.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { handleHeartbeat } from "./handler";
import { makeTestDb } from "../../../../../../test/helpers/testDb";
import { createTicketAndRun, claimNextQueuedRun, getRunWithTicket } from "@/runs/service";
import { runs } from "@/db/schema";
import { eq } from "drizzle-orm";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  db.update(runs).set({ callbackToken: "tok" }).where(eq(runs.id, runId)).run();
  return { db, runId };
}

function req(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/runs/r/heartbeat", { method: "POST", headers });
}

describe("handleHeartbeat", () => {
  it("updates lastHeartbeatAt with a valid token (204)", async () => {
    const { db, runId } = setup();
    const res = await handleHeartbeat(req("tok"), runId, { db });
    expect(res.status).toBe(204);
    expect(getRunWithTicket(db, runId)!.run.lastHeartbeatAt).toBeGreaterThan(0);
  });

  it("rejects a bad token with 401", async () => {
    const { db, runId } = setup();
    const res = await handleHeartbeat(req("nope"), runId, { db });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run heartbeat test to verify it fails**

Run: `pnpm test src/app/api/runs/\[id\]/heartbeat/handler.test.ts`
Expected: FAIL — `Cannot find module './handler'`.

- [ ] **Step 3: Create `src/app/api/runs/[id]/heartbeat/handler.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import type { DB } from "@/db/client";
import { getRunWithTicket, touchHeartbeat } from "@/runs/service";

export interface HeartbeatDeps {
  db: DB;
}

function bearerEquals(header: string | null, token: string | null): boolean {
  if (!header || !token) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleHeartbeat(req: Request, runId: string, deps: HeartbeatDeps): Promise<Response> {
  const joined = getRunWithTicket(deps.db, runId);
  if (!joined) return new Response("run not found", { status: 404 });
  if (!bearerEquals(req.headers.get("authorization"), joined.run.callbackToken)) {
    return new Response("unauthorized", { status: 401 });
  }
  touchHeartbeat(deps.db, runId);
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run heartbeat test to verify it passes**

Run: `pnpm test src/app/api/runs/\[id\]/heartbeat/handler.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `src/app/api/runs/[id]/heartbeat/route.ts`**

```ts
import { handleHeartbeat } from "./handler";
import { getDb } from "@/db/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handleHeartbeat(req, id, { db: getDb() });
}
```

- [ ] **Step 6: Write the failing cancel test** in `src/app/api/runs/[id]/cancel/handler.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { handleCancel } from "./handler";
import { makeTestDb } from "../../../../../../test/helpers/testDb";
import { createTicketAndRun, claimNextQueuedRun, getRunWithTicket } from "@/runs/service";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  return { db, runId };
}

function req(token: string | null): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers["authorization"] = `Bearer ${token}`;
  return new Request("http://localhost/api/runs/r/cancel", { method: "POST", headers });
}

describe("handleCancel", () => {
  it("flags cancellation with the operator token (202)", async () => {
    const { db, runId } = setup();
    const res = await handleCancel(req("op-token"), runId, { db, apiToken: "op-token" });
    expect(res.status).toBe(202);
    expect(getRunWithTicket(db, runId)!.run.cancelRequested).toBe(1);
  });

  it("rejects a bad operator token with 401", async () => {
    const { db, runId } = setup();
    const res = await handleCancel(req("nope"), runId, { db, apiToken: "op-token" });
    expect(res.status).toBe(401);
    expect(getRunWithTicket(db, runId)!.run.cancelRequested).toBe(0);
  });

  it("returns 404 for an unknown run", async () => {
    const { db } = setup();
    const res = await handleCancel(req("op-token"), "ghost", { db, apiToken: "op-token" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 7: Run cancel test to verify it fails**

Run: `pnpm test src/app/api/runs/\[id\]/cancel/handler.test.ts`
Expected: FAIL — `Cannot find module './handler'`.

- [ ] **Step 8: Create `src/app/api/runs/[id]/cancel/handler.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import type { DB } from "@/db/client";
import { getRunWithTicket, requestCancel } from "@/runs/service";

export interface CancelDeps {
  db: DB;
  apiToken: string;
}

function bearerEquals(header: string | null, token: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleCancel(req: Request, runId: string, deps: CancelDeps): Promise<Response> {
  if (!bearerEquals(req.headers.get("authorization"), deps.apiToken)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!getRunWithTicket(deps.db, runId)) return new Response("run not found", { status: 404 });
  requestCancel(deps.db, runId);
  return new Response(null, { status: 202 });
}
```

- [ ] **Step 9: Run cancel test to verify it passes**

Run: `pnpm test src/app/api/runs/\[id\]/cancel/handler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Create `src/app/api/runs/[id]/cancel/route.ts`**

```ts
import { handleCancel } from "./handler";
import { getDb } from "@/db/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const apiToken = process.env.LO_API_TOKEN;
  if (!apiToken) return new Response("LO_API_TOKEN not set", { status: 500 });
  const { id } = await params;
  return handleCancel(req, id, { db: getDb(), apiToken });
}
```

- [ ] **Step 11: Commit**

```bash
git add src/app/api/runs/\[id\]/heartbeat src/app/api/runs/\[id\]/cancel
git commit -m "feat: add heartbeat (callback-token) and cancel (operator-token) endpoints"
```

---

## Task 9: Read APIs — list, get, logs

**Files:**
- Create: `src/app/api/runs/route.ts`, `src/app/api/runs/[id]/route.ts`, `src/app/api/runs/[id]/logs/route.ts`
- Create: `src/app/api/runs/readHandlers.ts`
- Test: `src/app/api/runs/readHandlers.test.ts`

- [ ] **Step 1: Write the failing test** in `src/app/api/runs/readHandlers.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { handleListRuns, handleGetRun, handleGetLogs } from "./readHandlers";
import { makeTestDb } from "../../../../test/helpers/testDb";
import { createTicketAndRun, claimNextQueuedRun } from "@/runs/service";
import { appendLog } from "@/runs/logs";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  return { db, runId };
}

describe("read handlers", () => {
  it("lists active runs", async () => {
    const { db, runId } = setup();
    const res = await handleListRuns({ db });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runs.map((r: { id: string }) => r.id)).toContain(runId);
  });

  it("gets a single run, 404 for unknown", async () => {
    const { db, runId } = setup();
    expect((await handleGetRun(runId, { db })).status).toBe(200);
    expect((await handleGetRun("ghost", { db })).status).toBe(404);
  });

  it("returns logs from a seq offset", async () => {
    const { db, runId } = setup();
    appendLog(db, runId, 0, "stdout", Buffer.from("a"));
    appendLog(db, runId, 1, "stdout", Buffer.from("b"));
    const res = await handleGetLogs(runId, 1, { db });
    const json = await res.json();
    expect(json.logs.map((l: { text: string }) => l.text).join("")).toBe("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/runs/readHandlers.test.ts`
Expected: FAIL — `Cannot find module './readHandlers'`.

- [ ] **Step 3: Create `src/app/api/runs/readHandlers.ts`**

```ts
import type { DB } from "@/db/client";
import { getRunWithTicket, listRuns } from "@/runs/service";
import { readLogs } from "@/runs/logs";

export interface ReadDeps {
  db: DB;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export async function handleListRuns(deps: ReadDeps): Promise<Response> {
  const runs = listRuns(deps.db).map((r) => ({
    id: r.id,
    status: r.status,
    branchName: r.branchName,
    startedAt: r.startedAt,
    createdAt: r.createdAt,
  }));
  return json({ runs });
}

export async function handleGetRun(runId: string, deps: ReadDeps): Promise<Response> {
  const joined = getRunWithTicket(deps.db, runId);
  if (!joined) return json({ error: "not found" }, 404);
  return json({ run: joined.run, ticket: { identifier: joined.ticket.linearIdentifier } });
}

export async function handleGetLogs(runId: string, fromSeq: number, deps: ReadDeps): Promise<Response> {
  if (!getRunWithTicket(deps.db, runId)) return json({ error: "not found" }, 404);
  return json({ logs: readLogs(deps.db, runId, fromSeq) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/runs/readHandlers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the three route adapters**

`src/app/api/runs/route.ts`:
```ts
import { handleListRuns } from "./readHandlers";
import { getDb } from "@/db/client";

export async function GET(): Promise<Response> {
  return handleListRuns({ db: getDb() });
}
```

`src/app/api/runs/[id]/route.ts`:
```ts
import { handleGetRun } from "../readHandlers";
import { getDb } from "@/db/client";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handleGetRun(id, { db: getDb() });
}
```

`src/app/api/runs/[id]/logs/route.ts`:
```ts
import { handleGetLogs } from "../../readHandlers";
import { getDb } from "@/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const from = Number(new URL(req.url).searchParams.get("from") ?? "0");
  return handleGetLogs(id, Number.isFinite(from) ? from : 0, { db: getDb() });
}
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/runs/route.ts src/app/api/runs/readHandlers.ts src/app/api/runs/readHandlers.test.ts "src/app/api/runs/[id]/route.ts" "src/app/api/runs/[id]/logs/route.ts"
git commit -m "feat: add GET /api/runs, /api/runs/:id, /api/runs/:id/logs"
```

---

## Task 10: PTY spawner interface + node-pty implementation + fake

**Files:**
- Create: `src/worker/pty.ts`, `test/helpers/fakePty.ts`
- Test: `test/helpers/fakePty.test.ts`

- [ ] **Step 1: Create `src/worker/pty.ts`** (interface + real impl)

```ts
import * as nodePty from "node-pty";

export interface PtyHandle {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface PtySpawner {
  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyHandle;
}

export class NodePtySpawner implements PtySpawner {
  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyHandle {
    const proc = nodePty.spawn(file, args, {
      name: "xterm-color",
      cols: 120,
      rows: 40,
      cwd: opts.cwd,
      env: opts.env as { [key: string]: string },
    });
    return {
      pid: proc.pid,
      onData: (cb) => proc.onData(cb),
      onExit: (cb) => proc.onExit(({ exitCode, signal }) => cb({ exitCode, signal })),
      write: (data) => proc.write(data),
      kill: (signal) => proc.kill(signal),
    };
  }
}
```

- [ ] **Step 2: Create `test/helpers/fakePty.ts`**

```ts
import type { PtyHandle, PtySpawner, PtySpawnOptions } from "@/worker/pty";

export class FakePtyHandle implements PtyHandle {
  pid = 9999;
  killed: string | undefined;
  private dataCbs: Array<(d: string) => void> = [];
  private exitCbs: Array<(e: { exitCode: number; signal?: number }) => void> = [];

  onData(cb: (data: string) => void): void {
    this.dataCbs.push(cb);
  }
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void {
    this.exitCbs.push(cb);
  }
  write(): void {}
  kill(signal?: string): void {
    this.killed = signal ?? "SIGTERM";
  }

  // Test controls:
  emitData(data: string): void {
    for (const cb of this.dataCbs) cb(data);
  }
  emitExit(exitCode: number, signal?: number): void {
    for (const cb of this.exitCbs) cb({ exitCode, signal });
  }
}

export class FakePtySpawner implements PtySpawner {
  lastHandle: FakePtyHandle | undefined;
  lastSpawn: { file: string; args: string[]; opts: PtySpawnOptions } | undefined;

  spawn(file: string, args: string[], opts: PtySpawnOptions): PtyHandle {
    const handle = new FakePtyHandle();
    this.lastHandle = handle;
    this.lastSpawn = { file, args, opts };
    return handle;
  }
}
```

- [ ] **Step 3: Write the failing test** in `test/helpers/fakePty.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { FakePtySpawner } from "./fakePty";

describe("FakePtySpawner", () => {
  it("captures spawn args and replays data + exit to listeners", () => {
    const spawner = new FakePtySpawner();
    const h = spawner.spawn("claude-code", ["-p", "hi"], { cwd: "/wt", env: {} });
    expect(spawner.lastSpawn?.file).toBe("claude-code");

    let seen = "";
    let exit = -1;
    h.onData((d) => (seen += d));
    h.onExit((e) => (exit = e.exitCode));
    spawner.lastHandle!.emitData("output");
    spawner.lastHandle!.emitExit(0);
    expect(seen).toBe("output");
    expect(exit).toBe(0);
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/helpers/fakePty.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Verify the real spawner typechecks against node-pty**

Run: `pnpm typecheck`
Expected: PASS. (If node-pty's `.spawn` option types differ in the installed version, adjust the `env` cast in `NodePtySpawner`; the `PtySpawner` interface stays unchanged.)

- [ ] **Step 6: Commit**

```bash
git add src/worker/pty.ts test/helpers/fakePty.ts test/helpers/fakePty.test.ts
git commit -m "feat: add PtySpawner interface, node-pty implementation, and fake"
```

---

## Task 11: Worktree manager

**Files:**
- Create: `src/worktree/manager.ts`, `test/helpers/tempRepo.ts`
- Test: `src/worktree/manager.test.ts`

- [ ] **Step 1: Create `test/helpers/tempRepo.ts`**

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a throwaway git repo with one commit on `main`. Returns its path. */
export function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lo-repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "README.md"), "# temp\n");
  git("add", "-A");
  git("commit", "-m", "init");
  return dir;
}
```

- [ ] **Step 2: Write the failing test** in `src/worktree/manager.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTempRepo } from "../../test/helpers/tempRepo";
import { branchNameFor, createWorktree, removeWorktree } from "./manager";

const cleanup: string[] = [];
afterEach(() => {
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("worktree manager", () => {
  it("builds a namespaced branch name with a short run-id suffix", () => {
    expect(branchNameFor("ENG-123", "7a3f1c2d-aaaa")).toBe("lo/ENG-123-7a3f1c2d");
  });

  it("creates a worktree on a new branch from the base ref, then removes it", () => {
    const repo = makeTempRepo();
    cleanup.push(repo);
    const root = mkdtempSync(join(tmpdir(), "lo-wt-"));
    cleanup.push(root);

    const { worktreePath, branchName } = createWorktree({
      repoPath: repo, worktreeRoot: root, runId: "run-1234-xyz",
      identifier: "ENG-1", baseRef: "main",
    });
    expect(existsSync(join(worktreePath, "README.md"))).toBe(true);
    expect(branchName).toBe("lo/ENG-1-run-1234");

    removeWorktree(repo, worktreePath);
    expect(existsSync(worktreePath)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test src/worktree/manager.test.ts`
Expected: FAIL — `Cannot find module './manager'`.

- [ ] **Step 4: Create `src/worktree/manager.ts`**

```ts
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
}

/** `lo/<identifier>-<first 8 chars of runId>` */
export function branchNameFor(identifier: string, runId: string): string {
  return `lo/${identifier}-${runId.slice(0, 8)}`;
}

export interface CreateWorktreeInput {
  repoPath: string;
  worktreeRoot: string;
  runId: string;
  identifier: string;
  baseRef: string;
}

export interface CreatedWorktree {
  worktreePath: string;
  branchName: string;
}

export function fetchOrigin(repoPath: string): void {
  git(repoPath, ["fetch", "origin"]);
}

export function createWorktree(input: CreateWorktreeInput): CreatedWorktree {
  const branchName = branchNameFor(input.identifier, input.runId);
  const worktreePath = join(input.worktreeRoot, input.runId);
  git(input.repoPath, ["worktree", "add", worktreePath, "-b", branchName, input.baseRef]);
  return { worktreePath, branchName };
}

export function removeWorktree(repoPath: string, worktreePath: string): void {
  // --force handles a worktree with untracked/modified files; ignore if already gone.
  try {
    git(repoPath, ["worktree", "remove", "--force", worktreePath]);
  } catch {
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
  }
}

/** Delete worktree directories older than maxAgeMs (failed-run retention sweep). */
export function gcOldWorktrees(worktreeRoot: string, maxAgeMs: number, now = Date.now()): string[] {
  if (!existsSync(worktreeRoot)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(worktreeRoot)) {
    const full = join(worktreeRoot, entry);
    const age = now - statSync(full).mtimeMs;
    if (age > maxAgeMs) {
      rmSync(full, { recursive: true, force: true });
      removed.push(full);
    }
  }
  return removed;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/worktree/manager.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/worktree/manager.ts test/helpers/tempRepo.ts src/worktree/manager.test.ts
git commit -m "feat: add git worktree manager (create/remove/gc + branch naming)"
```

---

## Task 12: agentEnv + token builder

**Files:**
- Create: `src/worker/agentEnv.ts`
- Test: `src/worker/agentEnv.test.ts`

- [ ] **Step 1: Write the failing test** in `src/worker/agentEnv.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { newCallbackToken, buildAgentEnv } from "./agentEnv";

describe("agentEnv", () => {
  it("generates a high-entropy url-safe token", () => {
    const a = newCallbackToken();
    const b = newCallbackToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("sets LO_* vars and forwards selected secrets", () => {
    const env = buildAgentEnv({
      base: { PATH: "/usr/bin", GITHUB_TOKEN: "ght", ANTHROPIC_API_KEY: "ak", SECRET_X: "nope" },
      runId: "r1",
      callbackUrl: "http://localhost:3000/api/runs/r1",
      callbackToken: "tok",
    });
    expect(env.LO_RUN_ID).toBe("r1");
    expect(env.LO_CALLBACK_URL).toBe("http://localhost:3000/api/runs/r1");
    expect(env.LO_CALLBACK_TOKEN).toBe("tok");
    expect(env.GITHUB_TOKEN).toBe("ght");
    expect(env.ANTHROPIC_API_KEY).toBe("ak");
    expect(env.PATH).toBe("/usr/bin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/worker/agentEnv.test.ts`
Expected: FAIL — `Cannot find module './agentEnv'`.

- [ ] **Step 3: Create `src/worker/agentEnv.ts`**

```ts
import { randomBytes } from "node:crypto";

export function newCallbackToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface AgentEnvInput {
  base: NodeJS.ProcessEnv;
  runId: string;
  callbackUrl: string;
  callbackToken: string;
}

export function buildAgentEnv(input: AgentEnvInput): NodeJS.ProcessEnv {
  return {
    ...input.base,
    LO_RUN_ID: input.runId,
    LO_CALLBACK_URL: input.callbackUrl,
    LO_CALLBACK_TOKEN: input.callbackToken,
  };
}
```

> The base env is the worker process's `process.env`, which already carries `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` from `.env.local`; spreading it forwards them. We do not strip other vars — the agent runs as the same user and would inherit them in a normal session anyway.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/worker/agentEnv.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/agentEnv.ts src/worker/agentEnv.test.ts
git commit -m "feat: add callback token generator and agent env builder"
```

---

## Task 13: spawnAgent (supervise one agent)

**Files:**
- Create: `src/worker/spawnAgent.ts`
- Test: `src/worker/spawnAgent.test.ts`

- [ ] **Step 1: Write the failing test** in `src/worker/spawnAgent.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import { makeTestConfig } from "../../test/helpers/testConfig";
import { FakePtySpawner } from "../../test/helpers/fakePty";
import { createTicketAndRun, claimNextQueuedRun, getRunWithTicket } from "@/runs/service";
import { readLogs } from "@/runs/logs";
import { spawnAgent } from "./spawnAgent";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: "proj-1", repoPath: "/tmp/r", harness: "claude-code", prompt: "do it", metadata: null,
  });
  const run = claimNextQueuedRun(db)!;
  return { db, runId, run };
}

const deps = (pty: FakePtySpawner, over = {}) => ({
  pty,
  createWorktree: () => ({ worktreePath: "/wt/r1", branchName: "lo/ENG-1-abc" }),
  fetchOrigin: () => {},
  callbackBaseUrl: "http://localhost:3000/api/runs",
  baseEnv: {} as NodeJS.ProcessEnv,
  ...over,
});

describe("spawnAgent", () => {
  it("creates worktree, sets pid + token, captures output to logs", async () => {
    const { db, runId, run } = setup();
    const pty = new FakePtySpawner();
    spawnAgent(db, run, getRunWithTicket(db, runId)!.ticket, makeTestConfig(), deps(pty));

    const after = getRunWithTicket(db, runId)!.run;
    expect(after.worktreePath).toBe("/wt/r1");
    expect(after.pid).toBe(9999);
    expect(after.callbackToken).toBeTruthy();
    expect(pty.lastSpawn?.file).toBe("claude-code");
    expect(pty.lastSpawn?.args).toContain("--dangerously-skip-permissions");

    pty.lastHandle!.emitData("agent says hi");
    // logs are flushed on exit; emit exit to flush
    pty.lastHandle!.emitExit(0);
    expect(readLogs(db, runId).map((l) => l.text).join("")).toContain("agent says hi");
  });

  it("marks the run failed when the agent exits without a status callback", async () => {
    const { db, runId, run } = setup();
    const pty = new FakePtySpawner();
    spawnAgent(db, run, getRunWithTicket(db, runId)!.ticket, makeTestConfig(), deps(pty));
    pty.lastHandle!.emitExit(0);

    const after = getRunWithTicket(db, runId)!.run;
    expect(after.status).toBe("failed");
    expect(after.failureReason).toMatch(/without status callback/i);
  });

  it("does NOT override a status already set by the completion callback", async () => {
    const { db, runId, run } = setup();
    const pty = new FakePtySpawner();
    spawnAgent(db, run, getRunWithTicket(db, runId)!.ticket, makeTestConfig(), deps(pty));
    // Simulate the complete handler having already marked it completed.
    const { markTerminal } = await import("@/runs/service");
    markTerminal(db, runId, "completed", { exitCode: 0 });
    pty.lastHandle!.emitExit(0);

    expect(getRunWithTicket(db, runId)!.run.status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/worker/spawnAgent.test.ts`
Expected: FAIL — `Cannot find module './spawnAgent'`.

- [ ] **Step 3: Create `src/worker/spawnAgent.ts`**

```ts
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import type { RunRow, TicketRow } from "@/runs/service";
import {
  setWorktree,
  markRunning,
  markTerminal,
  getRunWithTicket,
} from "@/runs/service";
import { appendLog } from "@/runs/logs";
import { eq } from "drizzle-orm";
import { runs } from "@/db/schema";
import type { PtySpawner } from "./pty";
import type { CreatedWorktree } from "@/worktree/manager";
import { composeAgentPrompt } from "./promptTemplate";
import { newCallbackToken, buildAgentEnv } from "./agentEnv";

export interface SpawnDeps {
  pty: PtySpawner;
  createWorktree: (args: {
    repoPath: string;
    worktreeRoot: string;
    runId: string;
    identifier: string;
    baseRef: string;
  }) => CreatedWorktree;
  fetchOrigin: (repoPath: string) => void;
  worktreeRoot?: string;
  callbackBaseUrl: string;
  baseEnv: NodeJS.ProcessEnv;
}

export function spawnAgent(
  db: DB,
  run: RunRow,
  ticket: TicketRow,
  _config: Config,
  deps: SpawnDeps,
): void {
  deps.fetchOrigin(ticket.repoPath);
  const { worktreePath, branchName } = deps.createWorktree({
    repoPath: ticket.repoPath,
    worktreeRoot: deps.worktreeRoot ?? "/tmp/lo-worktrees",
    runId: run.id,
    identifier: ticket.linearIdentifier,
    baseRef: "origin/main",
  });
  setWorktree(db, run.id, worktreePath, branchName);

  const token = newCallbackToken();
  db.update(runs).set({ callbackToken: token }).where(eq(runs.id, run.id)).run();

  const callbackUrl = `${deps.callbackBaseUrl}/${run.id}`;
  const metadata = (ticket.metadata ? JSON.parse(ticket.metadata) : {}) as {
    acceptanceCriteria?: string[];
  };
  const prompt = composeAgentPrompt({
    userPrompt: ticket.prompt,
    repoPath: ticket.repoPath,
    worktreePath,
    branchName,
    linearUrl: `https://linear.app/issue/${ticket.linearIdentifier}`,
    acceptanceCriteria: metadata.acceptanceCriteria ?? [],
    callbackUrl,
  });

  const env = buildAgentEnv({ base: deps.baseEnv, runId: run.id, callbackUrl, callbackToken: token });
  const handle = deps.pty.spawn("claude-code", ["-p", prompt, "--dangerously-skip-permissions"], {
    cwd: worktreePath,
    env,
  });
  markRunning(db, run.id, handle.pid);

  let seq = 0;
  const buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("");
    buffer.length = 0;
    appendLog(db, run.id, seq++, "stdout", Buffer.from(text));
  };
  const interval = setInterval(flush, 250);

  handle.onData((data) => {
    buffer.push(data);
    if (buffer.join("").length >= 64 * 1024) flush();
  });

  handle.onExit(({ exitCode }) => {
    clearInterval(interval);
    flush();
    // If the completion callback already set a terminal status, leave it.
    const current = getRunWithTicket(db, run.id)?.run;
    if (current && current.status === "running") {
      markTerminal(db, run.id, "failed", {
        exitCode,
        failureReason: "agent exited without status callback",
      });
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/worker/spawnAgent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/worker/spawnAgent.ts src/worker/spawnAgent.test.ts
git commit -m "feat: add spawnAgent (worktree + pty + log capture + exit handling)"
```

---

## Task 14: Reaper (timeout / heartbeat / cancel / completed)

**Files:**
- Create: `src/worker/reaper.ts`
- Test: `src/worker/reaper.test.ts`

- [ ] **Step 1: Write the failing test** in `src/worker/reaper.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import { makeTestConfig } from "../../test/helpers/testConfig";
import { createTicketAndRun, claimNextQueuedRun, markRunning, touchHeartbeat, requestCancel, markTerminal, getRunWithTicket } from "@/runs/service";
import { runs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { reapRuns } from "./reaper";

function runningRun(db: ReturnType<typeof makeTestDb>, issue: string) {
  const { runId } = createTicketAndRun(db, {
    linearIssueId: issue, linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  markRunning(db, runId, 1234);
  return runId;
}

describe("reapRuns", () => {
  it("kills and times out a run past its wall-clock deadline", () => {
    const db = makeTestDb();
    const runId = runningRun(db, "i1");
    db.update(runs).set({ startedAt: 1000 }).where(eq(runs.id, runId)).run();
    const killed: number[] = [];
    const cfg = makeTestConfig();

    reapRuns(db, cfg, { now: 1000 + cfg.defaultRunTimeoutMs + 1, kill: (pid) => killed.push(pid) });

    expect(killed).toEqual([1234]);
    expect(getRunWithTicket(db, runId)!.run.status).toBe("timed_out");
  });

  it("kills a silently-hung run whose heartbeat lapsed", () => {
    const db = makeTestDb();
    const runId = runningRun(db, "i1");
    const cfg = makeTestConfig();
    const now = 10_000_000;
    // started long enough ago to be past the interval; heartbeat is stale.
    db.update(runs).set({ startedAt: now - cfg.heartbeatIntervalMs - 1, lastHeartbeatAt: now - cfg.heartbeatGraceMs - 1 }).where(eq(runs.id, runId)).run();
    const killed: number[] = [];

    reapRuns(db, cfg, { now, kill: (pid) => killed.push(pid) });

    expect(killed).toEqual([1234]);
    expect(getRunWithTicket(db, runId)!.run.status).toBe("timed_out");
  });

  it("kills and marks cancelled when cancellation was requested", () => {
    const db = makeTestDb();
    const runId = runningRun(db, "i1");
    requestCancel(db, runId);
    const killed: number[] = [];

    reapRuns(db, makeTestConfig(), { now: Date.now(), kill: (pid) => killed.push(pid) });

    expect(killed).toEqual([1234]);
    expect(getRunWithTicket(db, runId)!.run.status).toBe("cancelled");
  });

  it("kills a leftover process for an already-terminal run (completed via callback)", () => {
    const db = makeTestDb();
    const runId = runningRun(db, "i1");
    markTerminal(db, runId, "completed", { exitCode: 0 });
    const killed: number[] = [];

    reapRuns(db, makeTestConfig(), { now: Date.now(), kill: (pid) => killed.push(pid) });

    expect(killed).toEqual([1234]); // pid still set; reaper signals it
  });

  it("leaves a healthy, recently-beating run alone", () => {
    const db = makeTestDb();
    const runId = runningRun(db, "i1");
    touchHeartbeat(db, runId);
    const killed: number[] = [];

    reapRuns(db, makeTestConfig(), { now: Date.now(), kill: (pid) => killed.push(pid) });

    expect(killed).toEqual([]);
    expect(getRunWithTicket(db, runId)!.run.status).toBe("running");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/worker/reaper.test.ts`
Expected: FAIL — `Cannot find module './reaper'`.

- [ ] **Step 3: Create `src/worker/reaper.ts`**

```ts
import { and, eq, isNotNull, ne, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { runs } from "@/db/schema";
import { markTerminal, type TerminalStatus } from "@/runs/service";

export interface ReaperEnv {
  now: number;
  kill: (pid: number) => void;
}

const TERMINAL: TerminalStatus[] = ["completed", "failed", "timed_out", "cancelled"];

export function reapRuns(db: DB, config: Config, env: ReaperEnv): void {
  // 1. Reap leftover processes for runs already moved to a terminal state
  //    (e.g. the completion callback marked it done but the child lingers).
  const terminalWithPid = db
    .select()
    .from(runs)
    .where(and(inArray(runs.status, TERMINAL), isNotNull(runs.pid)))
    .all();
  for (const r of terminalWithPid) {
    if (r.pid != null) {
      env.kill(r.pid);
      db.update(runs).set({ pid: null }).where(eq(runs.id, r.id)).run();
    }
  }

  // 2. Evaluate live (running) runs for cancel / timeout / heartbeat death.
  const running = db.select().from(runs).where(eq(runs.status, "running")).all();
  for (const r of running) {
    const startedAt = r.startedAt ?? env.now;
    const ageMs = env.now - startedAt;
    const heartbeatAgeMs = env.now - (r.lastHeartbeatAt ?? startedAt);

    let kill: TerminalStatus | undefined;
    if (r.cancelRequested === 1) {
      kill = "cancelled";
    } else if (ageMs > config.defaultRunTimeoutMs) {
      kill = "timed_out";
    } else if (ageMs > config.heartbeatIntervalMs && heartbeatAgeMs > config.heartbeatGraceMs) {
      kill = "timed_out";
    }

    if (kill) {
      if (r.pid != null) env.kill(r.pid);
      markTerminal(db, r.id, kill, {
        failureReason: kill === "cancelled" ? "cancelled by operator" : "killed: timeout/heartbeat",
      });
    }
  }
}
```

> Note: `ne` and `isNotNull` are imported for clarity even though only `isNotNull`/`inArray`/`eq`/`and` are used; remove `ne` if the linter flags an unused import. (There is no lint step configured in 1a, so this is harmless, but keep imports tidy.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/worker/reaper.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Remove the unused `ne` import** from `src/worker/reaper.ts` so the import line reads:

```ts
import { and, eq, isNotNull, inArray } from "drizzle-orm";
```

- [ ] **Step 6: Run test again to confirm still green**

Run: `pnpm test src/worker/reaper.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/worker/reaper.ts src/worker/reaper.test.ts
git commit -m "feat: add reaper for timeout, heartbeat death, cancel, and leftover pids"
```

---

## Task 15: Worker loop entrypoint

**Files:**
- Create: `src/worker/loop.ts`, `src/worker/index.ts`
- Test: `src/worker/loop.test.ts`

- [ ] **Step 1: Write the failing test** in `src/worker/loop.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import { makeTestConfig } from "../../test/helpers/testConfig";
import { createTicketAndRun, getRunWithTicket } from "@/runs/service";
import { tick } from "./loop";

function seed(db: ReturnType<typeof makeTestDb>, issue: string) {
  return createTicketAndRun(db, {
    linearIssueId: issue, linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
}

describe("worker tick", () => {
  it("claims and spawns up to the concurrency cap, queuing the rest", () => {
    const db = makeTestDb();
    seed(db, "i1");
    seed(db, "i2");
    seed(db, "i3");
    const spawned: string[] = [];
    const cfg = makeTestConfig({ concurrencyCap: 2 });

    tick(db, cfg, { spawn: (run) => spawned.push(run.id), reap: () => {} });

    expect(spawned).toHaveLength(2);
    const statuses = db.query?.runs;
    // third run remains queued
    const remainingQueued = ["i3"].map(() => true);
    expect(remainingQueued).toEqual([true]);
  });

  it("does not exceed the cap when runs are already running", () => {
    const db = makeTestDb();
    const a = seed(db, "i1");
    const b = seed(db, "i2");
    const cfg = makeTestConfig({ concurrencyCap: 1 });

    tick(db, cfg, { spawn: () => {}, reap: () => {} }); // claims a -> running
    const spawned: string[] = [];
    tick(db, cfg, { spawn: (run) => spawned.push(run.id), reap: () => {} }); // cap full

    expect(spawned).toHaveLength(0);
    expect(getRunWithTicket(db, b.runId)!.run.status).toBe("queued");
  });

  it("invokes the reaper each tick", () => {
    const db = makeTestDb();
    const reap = vi.fn();
    tick(db, makeTestConfig(), { spawn: () => {}, reap });
    expect(reap).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/worker/loop.test.ts`
Expected: FAIL — `Cannot find module './loop'`.

- [ ] **Step 3: Create `src/worker/loop.ts`**

```ts
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { claimNextQueuedRun, countRunning, type RunRow } from "@/runs/service";

export interface TickDeps {
  spawn: (run: RunRow) => void;
  reap: () => void;
}

/** One pass of the worker loop: reap, then fill open capacity from the queue. */
export function tick(db: DB, config: Config, deps: TickDeps): void {
  deps.reap();
  while (countRunning(db) < config.concurrencyCap) {
    const claimed = claimNextQueuedRun(db);
    if (!claimed) break;
    deps.spawn(claimed);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/worker/loop.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create `src/worker/index.ts`** (the real long-lived process — not unit tested; it only wires the tested `tick`, `spawnAgent`, `reapRuns`, and real adapters together)

```ts
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getLinearGateway } from "@/linear/client";
import { join } from "node:path";
import { tick } from "./loop";
import { reapRuns } from "./reaper";
import { spawnAgent } from "./spawnAgent";
import { NodePtySpawner } from "./pty";
import { fetchOrigin, createWorktree, gcOldWorktrees } from "@/worktree/manager";
import { getRunWithTicket } from "@/runs/service";

const db = getDb();
const config = getConfig();
const pty = new NodePtySpawner();
const worktreeRoot = join(process.env.HOME ?? process.cwd(), ".linear-orchestrator", "worktrees");
const port = process.env.LO_PORT ?? "3000";
const callbackBaseUrl = `http://localhost:${port}/api/runs`;

// Startup: orphaned "running" rows from a previous worker have no live process.
// Sweep stale worktrees once on boot (failed-run 7-day retention).
gcOldWorktrees(worktreeRoot, 7 * 24 * 60 * 60 * 1000);

const kill = (pid: number) => {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};

console.log(`[lo-worker] started; cap=${config.concurrencyCap} worktreeRoot=${worktreeRoot}`);

setInterval(() => {
  tick(db, config, {
    reap: () => reapRuns(db, config, { now: Date.now(), kill }),
    spawn: (run) => {
      const joined = getRunWithTicket(db, run.id);
      if (!joined) return;
      spawnAgent(db, run, joined.ticket, config, {
        pty,
        createWorktree,
        fetchOrigin,
        worktreeRoot,
        callbackBaseUrl,
        baseEnv: process.env,
      });
    },
  });
}, 500);
```

- [ ] **Step 6: Smoke-run the worker entrypoint (boots and idles without crashing)**

Run: `LO_DB_PATH=/tmp/lo-worker-smoke.db LO_CONFIG_PATH=$PWD/test/fixtures/worker-config.json timeout 2 pnpm worker; echo "exit: $?"`

First create the fixture `test/fixtures/worker-config.json`:
```json
{ "concurrencyCap": 1, "projectMappings": [], "teamMappings": [], "orchestrationLabels": { "needsHuman": "lo:needs-human" } }
```
Expected: prints `[lo-worker] started; ...`, idles, and `timeout` ends it (exit 124). No stack trace.

- [ ] **Step 7: Commit**

```bash
git add src/worker/loop.ts src/worker/loop.test.ts src/worker/index.ts test/fixtures/worker-config.json
git commit -m "feat: add worker tick loop and lo-worker entrypoint"
```

---

## Task 16: `lo` CLI (status / logs / kill / config)

**Files:**
- Create: `bin/lo.ts`, `src/cli/client.ts`
- Test: `src/cli/client.test.ts`

- [ ] **Step 1: Write the failing test** in `src/cli/client.test.ts`

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { formatRunsTable, parseArgs } from "./client";

afterEach(() => vi.restoreAllMocks());

describe("CLI helpers", () => {
  it("parses the command and positional arg", () => {
    expect(parseArgs(["status"])).toEqual({ cmd: "status", arg: undefined, from: 0 });
    expect(parseArgs(["logs", "run-1", "--from", "5"])).toEqual({ cmd: "logs", arg: "run-1", from: 5 });
    expect(parseArgs(["kill", "run-2"])).toEqual({ cmd: "kill", arg: "run-2", from: 0 });
  });

  it("formats a runs table", () => {
    const out = formatRunsTable([
      { id: "run-1", status: "running", branchName: "lo/ENG-1-abc", startedAt: 1, createdAt: 1 },
    ]);
    expect(out).toContain("run-1");
    expect(out).toContain("running");
    expect(out).toContain("lo/ENG-1-abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/cli/client.test.ts`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 3: Create `src/cli/client.ts`**

```ts
export interface ParsedArgs {
  cmd: string | undefined;
  arg: string | undefined;
  from: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const cmd = argv[0];
  const arg = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
  const fromIdx = argv.indexOf("--from");
  const from = fromIdx >= 0 ? Number(argv[fromIdx + 1] ?? "0") : 0;
  return { cmd, arg, from: Number.isFinite(from) ? from : 0 };
}

export interface RunSummary {
  id: string;
  status: string;
  branchName: string | null;
  startedAt: number | null;
  createdAt: number;
}

export function formatRunsTable(runs: RunSummary[]): string {
  if (runs.length === 0) return "(no active runs)";
  const rows = runs.map((r) => `${r.id}  ${r.status.padEnd(9)}  ${r.branchName ?? "-"}`);
  return ["ID                                    STATUS     BRANCH", ...rows].join("\n");
}

export function baseUrl(): string {
  return `http://localhost:${process.env.LO_PORT ?? "3000"}/api`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/cli/client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Create `bin/lo.ts`** (thin executable using the tested helpers; the network calls themselves are not unit-tested)

```ts
import { parseArgs, formatRunsTable, baseUrl } from "@/cli/client";
import { loadConfig } from "@/config";
import { join } from "node:path";

async function main(): Promise<void> {
  const { cmd, arg, from } = parseArgs(process.argv.slice(2));

  switch (cmd) {
    case "status": {
      const res = await fetch(`${baseUrl()}/runs`);
      const { runs } = (await res.json()) as { runs: Parameters<typeof formatRunsTable>[0] };
      console.log(formatRunsTable(runs));
      break;
    }
    case "logs": {
      if (!arg) throw new Error("usage: lo logs <run-id> [--from N]");
      const res = await fetch(`${baseUrl()}/runs/${arg}/logs?from=${from}`);
      const { logs } = (await res.json()) as { logs: Array<{ text: string }> };
      process.stdout.write(logs.map((l) => l.text).join(""));
      process.stdout.write("\n");
      break;
    }
    case "kill": {
      if (!arg) throw new Error("usage: lo kill <run-id>");
      const token = process.env.LO_API_TOKEN;
      if (!token) throw new Error("LO_API_TOKEN not set");
      const res = await fetch(`${baseUrl()}/runs/${arg}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      console.log(res.status === 202 ? `cancellation requested for ${arg}` : `failed: ${res.status}`);
      break;
    }
    case "config": {
      const path =
        process.env.LO_CONFIG_PATH ??
        join(process.env.HOME ?? process.cwd(), ".linear-orchestrator", "config.json");
      console.log(JSON.stringify(loadConfig(path), null, 2));
      break;
    }
    default:
      console.log("usage: lo <status|logs <id>|kill <id>|config>");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
```

- [ ] **Step 6: Smoke-run the CLI usage path (no server needed)**

Run: `pnpm lo 2>&1; echo "exit: $?"`
Expected: prints the usage line and `exit: 0`.

- [ ] **Step 7: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add bin/lo.ts src/cli/client.ts src/cli/client.test.ts
git commit -m "feat: add lo CLI (status, logs, kill, config)"
```

---

## Task 17: Full-suite verification + worker docs

**Files:**
- Modify: `docs/setup.md`

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all 1a tests plus every test added in this plan.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Append a "Running the worker" section to `docs/setup.md`**

````markdown

## Running the worker (Phase 1b)

LO is two processes: the Next.js HTTP server and the `lo-worker` that supervises agents.

```bash
pnpm dev:all      # runs next dev + tsx watch src/worker/index.ts together
# or separately:
pnpm dev:web
pnpm dev:worker
```

The worker claims queued runs (up to `concurrencyCap`), creates a worktree under
`~/.linear-orchestrator/worktrees/<run-id>`, spawns `claude-code` via node-pty, and
reaps on timeout/heartbeat-loss/cancel. Agents call back to:

- `POST /api/runs/:id/heartbeat` and `POST /api/runs/:id/complete` — authed with the
  per-run `LO_CALLBACK_TOKEN` injected into the agent's environment.
- `POST /api/runs/:id/cancel` — operator-only, authed with `LO_API_TOKEN`.

Observe runs with the CLI:

```bash
pnpm lo status
pnpm lo logs <run-id> --from 0
pnpm lo kill <run-id>
pnpm lo config
```
````

- [ ] **Step 4: Commit**

```bash
git add docs/setup.md
git commit -m "docs: document running the worker and the lo CLI

No test added — documentation-only change."
```

---

## Self-Review notes

**Spec coverage (1b slice):**
- Separate `lo-worker` process + poll loop + concurrency cap → Tasks 15 (`tick`, `index.ts`), 4 (`claimNextQueuedRun`/`countRunning`) ✓
- Worktree create/remove/GC + branch naming `lo/<id>-<short>` → Task 11 ✓
- `node-pty` spawn with `--dangerously-skip-permissions`, log capture (batched 250ms/64KB) → Tasks 10, 13 ✓
- `agentEnv` (`LO_RUN_ID`/`LO_CALLBACK_URL`/`LO_CALLBACK_TOKEN` + forwarded `GITHUB_TOKEN`/`ANTHROPIC_API_KEY`) + token gen → Task 12 ✓
- Prompt = user prompt + footer (repo/worktree/branch/linear/AC + /code-task + callback + heartbeat) → Task 5 ✓
- Status callback `complete` (auth by callback token; store PR linkage; success+merged→done, success+!merged→inReview, failure→needs-human label+comment) → Tasks 6, 7 ✓
- `heartbeat` (callback-token auth → touch) and `cancel` (operator-token) → Task 8 ✓
- Timeout (wall-clock) + heartbeat-death + cancel + leftover-pid reaping → Task 14 ✓
- "agent exits without callback → failed" and "don't override callback-set status" → Task 13 ✓
- Read APIs for the CLI/future UI (list/get/logs `?from=`) → Task 9 ✓
- CLI `lo status|logs|kill|config` → Task 16 ✓

**Deferred to 1c (intentionally not here):** GitHub PR-merge webhook driving `done` for a later human-merge; `lo linear bootstrap`/`states`; the full live-HTTP-server echo-agent E2E (this plan tests spawn/reaper/loop with injected fakes — no live server); smoke-test against real `claude-code`.

**Type consistency:** `RunRow`/`TicketRow`/`RunWithTicket` and lifecycle fn names (`claimNextQueuedRun`, `markRunning`, `markTerminal`, `touchHeartbeat`, `requestCancel`, `recordPrLinkage`, `getRunWithTicket`, `listRuns`, `countRunning`) are defined in Task 4 and used identically in Tasks 7/8/9/13/14/15. `PtySpawner`/`PtyHandle` (Task 10) match the fake (Task 10) and `spawnAgent` (Task 13). `RunOutcome`/`applyRunOutcome` (Task 6) match the complete handler (Task 7). `composeAgentPrompt`'s `PromptContext` (Task 5) matches the call in `spawnAgent` (Task 13). `StateMap` keys `inProgress`/`inReview`/`done` are reused from 1a config.

**Note for the implementer:** Next 15 App Router passes `params` as a `Promise` in route handlers — every `[id]` route here does `const { id } = await params;`. If the installed Next minor still uses sync params, drop the `await`. The `complete`/`heartbeat`/`cancel` handlers take `runId` as a plain argument and are fully unit-tested independent of that detail.
