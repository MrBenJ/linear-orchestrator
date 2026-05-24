# Phase 1c: Merge Completion & Operator Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop — a merged GitHub PR drives the Linear ticket to `done` via a GitHub→LO webhook — and give operators a one-command way to discover and write a team's workflow-state mapping; verified by an in-process full-flow integration test plus a documented manual smoke test.

**Architecture:** A new `POST /api/webhooks/github` verifies the `X-Hub-Signature-256` HMAC, parses `pull_request` merge events, matches the run by its feature branch (`lo/<id>-<short-run-id>` = `head.ref`), and drives the ticket to `done` (reusing `applyRunOutcome`). A dependency-injected `bootstrap` module turns a team's workflow states into a `stateMap` and upserts it into `config.json`, exposed via `lo linear states` / `lo linear bootstrap`.

**Tech Stack:** TypeScript, better-sqlite3 + drizzle-orm, @linear/sdk (via `LinearGateway`), node crypto, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-22-phase-1-lo-core-and-agent-runner-design.md`

**Builds on 1a/1b (merged):** `getDb`/`DB`, schema (`runs` has `prNumber`/`prState`/`branchName`), `getConfig`/`loadConfig`/`resolveStateMap` (`src/config`), `LinearGateway`/`getLinearGateway`/`FakeLinearGateway`, `applyRunOutcome` (`src/linear/ticketActions.ts`), `proposeStateMap` (`src/linear/stateMapping.ts`), `getRunWithTicket`/`markTerminal`/`recordPrLinkage`/`createTicketAndRun`/`claimNextQueuedRun` (`src/runs/service.ts`), the `verifyLinearSignature` HMAC pattern, the read-handler bearer-auth pattern, `parseArgs`/`baseUrl` + the `lo` CLI (`bin/lo.ts`, `src/cli/client.ts`), `FakePtySpawner`, `spawnAgent`, `tick`.

**Scope of 1c:** GitHub PR-merge webhook (signature + handler + route) · `findRunByBranch` + `markPrMerged` · `bootstrap` module (state-map discovery + config upsert) · `lo linear states`/`lo linear bootstrap` · in-process full-flow integration test · `docs/smoke-test.md`.

**Out of scope:** Phase 2 (writing skill), Phase 3 (QA agent), Phase 4 (UI).

---

## File structure (created/modified by this plan)

```
src/github/webhook.ts                       (new: verifyGithubSignature + parseMergeEvent)
src/runs/service.ts                          (modify: findRunByBranch, markPrMerged)
src/app/api/webhooks/github/handler.ts       (new)
src/app/api/webhooks/github/route.ts         (new)
src/linear/bootstrap.ts                       (new: buildTeamStateMap + upsertTeamMapping)
src/cli/client.ts                             (modify: parseLinearSubcommand + state formatter)
bin/lo.ts                                     (modify: linear states/bootstrap commands)
test/fullFlow.test.ts                         (new: in-process E2E)
docs/smoke-test.md                            (new)
docs/setup.md                                 (modify: GitHub webhook + bootstrap)
```

---

## Task 1: GitHub webhook signature + merge-event parser

**Files:**
- Create: `src/github/webhook.ts`
- Test: `src/github/webhook.test.ts`

- [ ] **Step 1: Write the failing test** in `src/github/webhook.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGithubSignature, parseMergeEvent } from "./webhook";

const secret = "gh-secret";
function sign(body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyGithubSignature", () => {
  it("accepts a correct sha256= signature", () => {
    const body = JSON.stringify({ action: "closed" });
    expect(verifyGithubSignature(body, sign(body), secret)).toBe(true);
  });
  it("rejects a wrong signature and a missing one", () => {
    expect(verifyGithubSignature("{}", "sha256=deadbeef", secret)).toBe(false);
    expect(verifyGithubSignature("{}", null, secret)).toBe(false);
  });
});

describe("parseMergeEvent", () => {
  it("extracts branch + pr number for a merged PR", () => {
    const ev = parseMergeEvent({
      action: "closed",
      pull_request: { number: 7, merged: true, html_url: "u", head: { ref: "lo/ENG-1-abcd1234" } },
    });
    expect(ev).toEqual({ branch: "lo/ENG-1-abcd1234", prNumber: 7, prUrl: "u" });
  });
  it("returns null for closed-without-merge and non-pull_request payloads", () => {
    expect(parseMergeEvent({ action: "closed", pull_request: { number: 7, merged: false, head: { ref: "x" } } })).toBeNull();
    expect(parseMergeEvent({ action: "opened", pull_request: { number: 7, merged: true, head: { ref: "x" } } })).toBeNull();
    expect(parseMergeEvent({ zen: "hello" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/github/webhook.test.ts`
Expected: FAIL — `Cannot find module './webhook'`.

- [ ] **Step 3: Create `src/github/webhook.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface MergeEvent {
  branch: string;
  prNumber: number;
  prUrl: string;
}

interface GithubPrPayload {
  action?: string;
  pull_request?: {
    number?: number;
    merged?: boolean;
    html_url?: string;
    head?: { ref?: string };
  };
}

/** Returns merge details for a `pull_request closed+merged` event, else null. */
export function parseMergeEvent(payload: unknown): MergeEvent | null {
  const p = payload as GithubPrPayload;
  if (p.action !== "closed") return null;
  const pr = p.pull_request;
  if (!pr || pr.merged !== true) return null;
  const branch = pr.head?.ref;
  if (!branch || typeof pr.number !== "number") return null;
  return { branch, prNumber: pr.number, prUrl: pr.html_url ?? "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/github/webhook.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/github/webhook.ts src/github/webhook.test.ts
git commit -m "feat: add GitHub webhook signature verify and merge-event parser"
```

---

## Task 2: `findRunByBranch` + `markPrMerged`

**Files:**
- Modify: `src/runs/service.ts`
- Test: `src/runs/findByBranch.test.ts`

- [ ] **Step 1: Write the failing test** in `src/runs/findByBranch.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import { createTicketAndRun, claimNextQueuedRun, setWorktree, findRunByBranch, markPrMerged, getRunWithTicket } from "./service";

function seed(db: ReturnType<typeof makeTestDb>, issue: string, branch: string) {
  const { runId } = createTicketAndRun(db, {
    linearIssueId: issue, linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  setWorktree(db, runId, `/wt/${runId}`, branch);
  return runId;
}

describe("findRunByBranch", () => {
  it("finds the run + ticket by feature branch", () => {
    const db = makeTestDb();
    const runId = seed(db, "i1", "lo/ENG-1-aaaa1111");
    const found = findRunByBranch(db, "lo/ENG-1-aaaa1111");
    expect(found?.run.id).toBe(runId);
    expect(found?.ticket.linearIssueId).toBe("i1");
  });

  it("returns undefined for an unknown branch", () => {
    const db = makeTestDb();
    seed(db, "i1", "lo/ENG-1-aaaa1111");
    expect(findRunByBranch(db, "lo/ENG-9-zzzz")).toBeUndefined();
  });
});

describe("markPrMerged", () => {
  it("sets prState=merged and records the pr number/url", () => {
    const db = makeTestDb();
    const runId = seed(db, "i1", "lo/ENG-1-aaaa1111");
    markPrMerged(db, runId, "https://github.com/o/r/pull/12");
    const { run } = getRunWithTicket(db, runId)!;
    expect(run.prState).toBe("merged");
    expect(run.prNumber).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/runs/findByBranch.test.ts`
Expected: FAIL — `findRunByBranch`/`markPrMerged` are not exported.

- [ ] **Step 3: Append to `src/runs/service.ts`** (after `getRunWithTicket`)

```ts
export function findRunByBranch(db: DB, branchName: string): RunWithTicket | undefined {
  const run = db
    .select()
    .from(runs)
    .where(eq(runs.branchName, branchName))
    .orderBy(desc(runs.createdAt))
    .limit(1)
    .get();
  if (!run) return undefined;
  const ticket = db.select().from(tickets).where(eq(tickets.id, run.ticketId)).get();
  if (!ticket) return undefined;
  return { run, ticket };
}

export function markPrMerged(db: DB, runId: string, prUrl: string): void {
  recordPrLinkage(db, runId, prUrl, "merged");
}
```

Update the `drizzle-orm` import at the top of the file to add `desc`:

```ts
import { asc, desc, eq, inArray } from "drizzle-orm";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/runs/findByBranch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/runs/service.ts src/runs/findByBranch.test.ts
git commit -m "feat: add findRunByBranch and markPrMerged for merge-webhook matching"
```

---

## Task 3: `POST /api/webhooks/github` handler

**Files:**
- Create: `src/app/api/webhooks/github/handler.ts`
- Test: `src/app/api/webhooks/github/handler.test.ts`

- [ ] **Step 1: Write the failing test** in `src/app/api/webhooks/github/handler.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleGithubWebhook } from "./handler";
import { makeTestDb } from "../../../../../test/helpers/testDb";
import { makeTestConfig } from "../../../../../test/helpers/testConfig";
import { FakeLinearGateway } from "../../../../../test/helpers/fakeLinear";
import { createTicketAndRun, claimNextQueuedRun, setWorktree, markTerminal, getRunWithTicket } from "@/runs/service";

const secret = "gh-secret";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "issue-1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: "proj-1", repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  setWorktree(db, runId, "/wt/x", "lo/ENG-1-abcd1234");
  // agent finished with PR open, parked in inReview
  markTerminal(db, runId, "completed", { exitCode: 0 });
  return { db, runId, config: makeTestConfig(), linear: new FakeLinearGateway() };
}

function req(body: unknown, sign = true): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sign) headers["x-hub-signature-256"] = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return new Request("http://localhost/api/webhooks/github", { method: "POST", headers, body: raw });
}

const merged = {
  action: "closed",
  pull_request: { number: 12, merged: true, html_url: "https://github.com/o/r/pull/12", head: { ref: "lo/ENG-1-abcd1234" } },
};

describe("handleGithubWebhook", () => {
  it("drives the matched ticket to done on a merged PR", async () => {
    const { db, runId, config, linear } = setup();
    const res = await handleGithubWebhook(req(merged), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(200);
    expect(linear.stateUpdates).toEqual([{ issueId: "issue-1", stateId: "s-done" }]);
    expect(getRunWithTicket(db, runId)!.run.prState).toBe("merged");
  });

  it("rejects a bad signature with 401", async () => {
    const { db, config, linear } = setup();
    const res = await handleGithubWebhook(req(merged, false), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(401);
  });

  it("acknowledges unmatched / non-merge events with 200 and does nothing", async () => {
    const { db, config, linear } = setup();
    const ping = { action: "closed", pull_request: { number: 99, merged: false, head: { ref: "other" } } };
    const res = await handleGithubWebhook(req(ping), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(200);
    expect(linear.stateUpdates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/webhooks/github/handler.test.ts`
Expected: FAIL — `Cannot find module './handler'`.

- [ ] **Step 3: Create `src/app/api/webhooks/github/handler.ts`**

```ts
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { resolveStateMap } from "@/config";
import type { LinearGateway } from "@/linear/gateway";
import { applyRunOutcome } from "@/linear/ticketActions";
import { findRunByBranch, markPrMerged } from "@/runs/service";
import { verifyGithubSignature, parseMergeEvent } from "@/github/webhook";

export interface GithubWebhookDeps {
  db: DB;
  config: Config;
  linear: LinearGateway;
  webhookSecret: string;
}

export async function handleGithubWebhook(req: Request, deps: GithubWebhookDeps): Promise<Response> {
  const rawBody = await req.text();
  if (!verifyGithubSignature(rawBody, req.headers.get("x-hub-signature-256"), deps.webhookSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("ok", { status: 200 });
  }

  const merge = parseMergeEvent(payload);
  if (!merge) return new Response("ok", { status: 200 });

  const found = findRunByBranch(deps.db, merge.branch);
  if (!found) return new Response("ok", { status: 200 }); // not an LO-managed PR

  markPrMerged(deps.db, found.run.id, merge.prUrl);

  const stateMap = resolveStateMap(deps.config, found.ticket.linearTeamId);
  if (stateMap) {
    await applyRunOutcome(deps.linear, {
      issueId: found.ticket.linearIssueId,
      teamId: found.ticket.linearTeamId,
      stateMap,
      needsHumanLabel: deps.config.orchestrationLabels.needsHuman,
      outcome: { status: "success", prMerged: true, prUrl: merge.prUrl },
    });
  }

  return new Response("ok", { status: 200 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/webhooks/github/handler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/github/handler.test.ts src/app/api/webhooks/github/handler.ts
git commit -m "feat: add GitHub merge webhook handler driving the ticket to done"
```

---

## Task 4: GitHub webhook route adapter

**Files:**
- Create: `src/app/api/webhooks/github/route.ts`

- [ ] **Step 1: Create `src/app/api/webhooks/github/route.ts`**

```ts
import { handleGithubWebhook } from "./handler";
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getLinearGateway } from "@/linear/client";

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) return new Response("GITHUB_WEBHOOK_SECRET not set", { status: 500 });
  return handleGithubWebhook(req, {
    db: getDb(),
    config: getConfig(),
    linear: getLinearGateway(),
    webhookSecret,
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/github/route.ts
git commit -m "feat: wire POST /api/webhooks/github route"
```

---

## Task 5: Bootstrap module (state-map discovery + config upsert)

**Files:**
- Create: `src/linear/bootstrap.ts`
- Test: `src/linear/bootstrap.test.ts`

- [ ] **Step 1: Write the failing test** in `src/linear/bootstrap.test.ts`

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeLinearGateway } from "../../test/helpers/fakeLinear";
import { buildTeamStateMap, upsertTeamMapping } from "./bootstrap";

const cleanup: string[] = [];
afterEach(() => {
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("buildTeamStateMap", () => {
  it("proposes a state map from the team's workflow states", async () => {
    const linear = new FakeLinearGateway();
    linear.states = [
      { id: "todo", name: "Todo", type: "unstarted", position: 1 },
      { id: "dev", name: "In Dev", type: "started", position: 2 },
      { id: "review", name: "Review", type: "started", position: 3 },
      { id: "done", name: "Done", type: "completed", position: 4 },
    ];
    const { stateMap, warnings } = await buildTeamStateMap(linear, "team-1");
    expect(stateMap).toEqual({ inProgress: "dev", inReview: "review", done: "done" });
    expect(warnings).toEqual([]);
  });
});

describe("upsertTeamMapping", () => {
  it("adds a team mapping to a config file, preserving other fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "lo-cfg-"));
    cleanup.push(dir);
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({ concurrencyCap: 3, projectMappings: [{ linearProjectId: "p", repoPath: "/r" }] }));

    upsertTeamMapping(path, "team-1", { inProgress: "dev", inReview: "review", done: "done" });

    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.concurrencyCap).toBe(3);
    expect(written.projectMappings).toHaveLength(1);
    expect(written.teamMappings).toEqual([
      { linearTeamId: "team-1", stateMap: { inProgress: "dev", inReview: "review", done: "done" } },
    ]);
  });

  it("replaces an existing mapping for the same team", () => {
    const dir = mkdtempSync(join(tmpdir(), "lo-cfg-"));
    cleanup.push(dir);
    const path = join(dir, "config.json");
    writeFileSync(path, JSON.stringify({
      teamMappings: [{ linearTeamId: "team-1", stateMap: { inProgress: "old", inReview: "old", done: "old" } }],
    }));

    upsertTeamMapping(path, "team-1", { inProgress: "dev", inReview: "review", done: "done" });

    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.teamMappings).toHaveLength(1);
    expect(written.teamMappings[0].stateMap.inProgress).toBe("dev");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/linear/bootstrap.test.ts`
Expected: FAIL — `Cannot find module './bootstrap'`.

- [ ] **Step 3: Create `src/linear/bootstrap.ts`**

```ts
import { readFileSync, writeFileSync } from "node:fs";
import type { LinearGateway, WorkflowState } from "./gateway";
import { proposeStateMap } from "./stateMapping";
import type { StateMap } from "@/config/types";

export interface BuiltStateMap {
  stateMap: Partial<StateMap>;
  warnings: string[];
  states: WorkflowState[];
}

export async function buildTeamStateMap(linear: LinearGateway, teamId: string): Promise<BuiltStateMap> {
  const states = await linear.listWorkflowStates(teamId);
  const { stateMap, warnings } = proposeStateMap(states);
  return { stateMap, warnings, states };
}

interface ConfigShape {
  teamMappings?: Array<{ linearTeamId: string; stateMap: StateMap }>;
  [key: string]: unknown;
}

/** Read config JSON, upsert the team's stateMap, write it back (other fields preserved). */
export function upsertTeamMapping(configPath: string, teamId: string, stateMap: StateMap): void {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as ConfigShape;
  const mappings = config.teamMappings ?? [];
  const next = mappings.filter((m) => m.linearTeamId !== teamId);
  next.push({ linearTeamId: teamId, stateMap });
  config.teamMappings = next;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/linear/bootstrap.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/linear/bootstrap.ts src/linear/bootstrap.test.ts
git commit -m "feat: add team state-map discovery and config upsert for bootstrap"
```

---

## Task 6: `lo linear states` / `lo linear bootstrap` CLI

**Files:**
- Modify: `src/cli/client.ts`, `bin/lo.ts`
- Test: `src/cli/client.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/cli/client.test.ts`

```ts
import { parseLinearSubcommand, formatWorkflowStates } from "./client";

describe("linear subcommand parsing", () => {
  it("parses the sub and teamId", () => {
    expect(parseLinearSubcommand(["linear", "states", "team-1"])).toEqual({ sub: "states", teamId: "team-1" });
    expect(parseLinearSubcommand(["linear", "bootstrap"])).toEqual({ sub: "bootstrap", teamId: undefined });
  });
});

describe("formatWorkflowStates", () => {
  it("renders id, type, and name", () => {
    const out = formatWorkflowStates([{ id: "dev", name: "In Dev", type: "started", position: 2 }]);
    expect(out).toContain("dev");
    expect(out).toContain("started");
    expect(out).toContain("In Dev");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/cli/client.test.ts`
Expected: FAIL — `parseLinearSubcommand`/`formatWorkflowStates` are not exported.

- [ ] **Step 3: Append to `src/cli/client.ts`**

```ts
import type { WorkflowState } from "@/linear/gateway";

export function parseLinearSubcommand(argv: string[]): { sub: string | undefined; teamId: string | undefined } {
  // argv like ["linear", "states", "team-1"]
  return { sub: argv[1], teamId: argv[2] };
}

export function formatWorkflowStates(states: WorkflowState[]): string {
  if (states.length === 0) return "(no workflow states)";
  return states
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.id}  ${s.type.padEnd(10)}  ${s.name}`)
    .join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/cli/client.test.ts`
Expected: PASS (all CLI helper tests).

- [ ] **Step 5: Add the `linear` command branch to `bin/lo.ts`** — insert a new `case` before the `default:` in the `switch (cmd)`:

```ts
    case "linear": {
      const { parseLinearSubcommand, formatWorkflowStates } = await import("@/cli/client");
      const { getLinearGateway } = await import("@/linear/client");
      const { buildTeamStateMap, upsertTeamMapping } = await import("@/linear/bootstrap");
      const { join } = await import("node:path");
      const { sub, teamId } = parseLinearSubcommand(process.argv.slice(2));
      if (!teamId) throw new Error("usage: lo linear <states|bootstrap> <teamId>");
      const linear = getLinearGateway();

      if (sub === "states") {
        const states = await linear.listWorkflowStates(teamId);
        console.log(formatWorkflowStates(states));
      } else if (sub === "bootstrap") {
        const { stateMap, warnings } = await buildTeamStateMap(linear, teamId);
        for (const w of warnings) console.warn(`warning: ${w}`);
        if (!stateMap.inProgress || !stateMap.inReview || !stateMap.done) {
          throw new Error("could not resolve a full stateMap; run `lo linear states` and set it manually");
        }
        const configPath =
          process.env.LO_CONFIG_PATH ??
          join(process.env.HOME ?? process.cwd(), ".linear-orchestrator", "config.json");
        upsertTeamMapping(configPath, teamId, {
          inProgress: stateMap.inProgress,
          inReview: stateMap.inReview,
          done: stateMap.done,
        });
        console.log(`wrote stateMap for ${teamId} to ${configPath}`);
      } else {
        throw new Error("usage: lo linear <states|bootstrap> <teamId>");
      }
      break;
    }
```

Also update the `default:` usage line:

```ts
    default:
      console.log("usage: lo <status|logs <id>|kill <id>|config|linear <states|bootstrap> <teamId>>");
      process.exit(cmd ? 1 : 0);
```

- [ ] **Step 6: Verify typecheck + CLI usage smoke**

Run: `pnpm typecheck && pnpm lo`
Expected: typecheck PASS; `pnpm lo` prints the updated usage line.

- [ ] **Step 7: Commit**

```bash
git add src/cli/client.ts src/cli/client.test.ts bin/lo.ts
git commit -m "feat: add lo linear states and lo linear bootstrap commands"
```

---

## Task 7: In-process full-flow integration test

**Files:**
- Create: `test/fullFlow.test.ts`

This wires the real handlers together — intake → worker spawn → completion callback → GitHub merge — through the in-memory DB and fakes, asserting the Linear state sequence `inProgress → inReview → done`.

- [ ] **Step 1: Write the test** in `test/fullFlow.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { makeTestDb } from "./helpers/testDb";
import { makeTestConfig } from "./helpers/testConfig";
import { FakeLinearGateway } from "./helpers/fakeLinear";
import { FakePtySpawner } from "./helpers/fakePty";
import { handleCreateTickets } from "@/app/api/tickets/handler";
import { handleComplete } from "@/app/api/runs/[id]/complete/handler";
import { handleGithubWebhook } from "@/app/api/webhooks/github/handler";
import { tick } from "@/worker/loop";
import { spawnAgent } from "@/worker/spawnAgent";
import { getRunWithTicket } from "@/runs/service";

const API_TOKEN = "op-token";
const GH_SECRET = "gh-secret";

describe("full flow: intake -> worker -> complete -> merge -> done", () => {
  it("drives the ticket inProgress -> inReview -> done", async () => {
    const db = makeTestDb();
    const config = makeTestConfig();
    const linear = new FakeLinearGateway();
    const pty = new FakePtySpawner();

    // 1. Intake creates the issue + queued run and transitions to inProgress.
    const ticketReq = new Request("http://localhost/api/tickets", {
      method: "POST",
      headers: { authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify({
        tickets: [{ linearTeamId: "team-1", linearProjectId: "proj-1", title: "T", prompt: "do", harness: "claude-code" }],
      }),
    });
    const ticketRes = await handleCreateTickets(ticketReq, { db, config, linear, apiToken: API_TOKEN });
    const { tickets } = (await ticketRes.json()) as { tickets: Array<{ runId: string }> };
    const runId = tickets[0].runId;

    // 2. Worker claims + spawns the agent (fake pty, fake worktree).
    tick(db, config, {
      reap: () => {},
      spawn: (run) => {
        const joined = getRunWithTicket(db, run.id)!;
        spawnAgent(db, run, joined.ticket, config, {
          pty,
          createWorktree: () => ({ worktreePath: "/wt/x", branchName: "lo/ENG-1-abcd1234" }),
          fetchOrigin: () => {},
          callbackBaseUrl: "http://localhost:3000/api/runs",
          baseEnv: {},
        });
      },
    });

    // 3. Agent completes with an open (un-merged) PR -> ticket parks in inReview.
    const token = getRunWithTicket(db, runId)!.run.callbackToken!;
    const completeReq = new Request(`http://localhost/api/runs/${runId}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "success", prUrl: "https://github.com/o/r/pull/12", prMerged: false }),
    });
    expect((await handleComplete(completeReq, runId, { db, config, linear })).status).toBe(200);
    pty.lastHandle!.emitExit(0); // agent process exits; status already completed

    // 4. GitHub merge webhook -> ticket -> done.
    const ghBody = JSON.stringify({
      action: "closed",
      pull_request: { number: 12, merged: true, html_url: "https://github.com/o/r/pull/12", head: { ref: "lo/ENG-1-abcd1234" } },
    });
    const ghReq = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", GH_SECRET).update(ghBody).digest("hex") },
      body: ghBody,
    });
    expect((await handleGithubWebhook(ghReq, { db, config, linear, webhookSecret: GH_SECRET })).status).toBe(200);

    // Assert the full Linear state progression on the issue.
    expect(linear.stateUpdates).toEqual([
      { issueId: "issue-1", stateId: "s-prog" },
      { issueId: "issue-1", stateId: "s-rev" },
      { issueId: "issue-1", stateId: "s-done" },
    ]);
    expect(getRunWithTicket(db, runId)!.run.prState).toBe("merged");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm test test/fullFlow.test.ts`
Expected: PASS (1 test). This is a green-from-the-start integration test over already-built units; if it fails, the failure pinpoints a real wiring mismatch between handlers — fix the handler, not the test.

- [ ] **Step 3: Commit**

```bash
git add test/fullFlow.test.ts
git commit -m "test: add in-process full-flow integration (intake to done)"
```

---

## Task 8: Smoke-test doc + full verification

**Files:**
- Create: `docs/smoke-test.md`
- Modify: `docs/setup.md`

- [ ] **Step 1: Run the full suite + typecheck + build**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all PASS. (Then restore tsconfig if `next build` rewrote it: `git checkout tsconfig.json`.)

- [ ] **Step 2: Create `docs/smoke-test.md`**

````markdown
# Manual smoke test (Phase 1)

End-to-end check against a real Linear sandbox + GitHub repo + claude-code. Run before a release.

## Prerequisites
- `.env.local` has `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `LO_API_TOKEN`, `ANTHROPIC_API_KEY`.
- A tunnel (ngrok/cloudflared) pointing at `localhost:$LO_PORT`.
- Linear webhook → `<tunnel>/api/webhooks/linear`; GitHub webhook (repo, `pull_request` events) → `<tunnel>/api/webhooks/github`.
- `~/.linear-orchestrator/config.json` has a `projectMappings` entry for your test project.

## Steps
1. Discover + write the team state map:
   ```bash
   export $(grep -v '^#' .env.local | xargs)   # load LINEAR_API_KEY etc. for the CLI
   pnpm lo linear states <teamId>               # eyeball the states
   pnpm lo linear bootstrap <teamId>            # writes stateMap into config.json
   ```
2. Start both processes: `pnpm dev:all`.
3. Create a ticket (the writing skill does this in Phase 2; for now, curl):
   ```bash
   curl -X POST localhost:$LO_PORT/api/tickets \
     -H "authorization: Bearer $LO_API_TOKEN" -H 'content-type: application/json' \
     -d '{"tickets":[{"linearTeamId":"<team>","linearProjectId":"<project>","title":"Smoke","prompt":"Add a hello function with a test.","harness":"claude-code"}]}'
   ```
4. Watch it: `pnpm lo status`, then `pnpm lo logs <run-id>`. The Linear issue moves to your `inProgress` state.
5. The agent runs `/code-task`, opens a PR, and posts `complete`. The issue moves to `inReview` (open PR) or `done` (auto-merged).
6. If the PR was left open, merge it on GitHub. The `pull_request` merge webhook drives the issue to `done`.
7. Confirm the worktree under `~/.linear-orchestrator/worktrees/<run-id>` is removed for a completed run.

## Pass criteria
- Linear issue progressed inProgress → inReview → done.
- A PR was opened and (eventually) merged.
- `lo logs` shows the captured agent output.
- A forced failure (e.g. an impossible prompt) lands the `lo:needs-human` label + a comment.
````

- [ ] **Step 3: Append the GitHub webhook + bootstrap to `docs/setup.md`** (after the "Running the worker" section)

````markdown

## GitHub merge webhook + team bootstrap (Phase 1c)

Register a GitHub webhook on each managed repo (or the org), `Content-Type: application/json`,
secret = `GITHUB_WEBHOOK_SECRET`, events = **Pull requests**, pointing at
`<tunnel>/api/webhooks/github`. On a `pull_request` merge, LO matches the run by its
`lo/<id>-<short-run-id>` head branch and transitions the ticket to your mapped `done` state.

Discover and write a team's workflow-state mapping (needs `LINEAR_API_KEY` in the env):

```bash
pnpm lo linear states <teamId>        # list states (id / type / name)
pnpm lo linear bootstrap <teamId>     # propose + write stateMap into config.json
```
````

- [ ] **Step 4: Commit**

```bash
git add docs/smoke-test.md docs/setup.md
git commit -m "docs: add manual smoke test and GitHub-webhook/bootstrap setup

No test added — documentation-only change."
```

---

## Self-Review notes

**Spec coverage (1c slice):**
- `POST /api/webhooks/github` with HMAC (`X-Hub-Signature-256`), `pull_request closed+merged` only → Tasks 1, 3, 4 ✓
- Match run by head branch (`lo/<id>-<short-run-id>`), fall through `200` for unmatched/unknown → Tasks 1 (`parseMergeEvent`), 2 (`findRunByBranch`), 3 ✓
- Drive ticket to `done` + set `prState=merged` on merge → Tasks 2 (`markPrMerged`), 3 (reuses `applyRunOutcome`) ✓
- `lo linear states` / `lo linear bootstrap` (auto-discover + write `stateMap`, fail loud if unresolvable) → Tasks 5, 6 ✓
- End-to-end verification → Task 7 (automated in-process) + Task 8 (`docs/smoke-test.md`, manual real-services) ✓

**Phase 1 is complete after 1c:** intake (1a) → worker execution (1b) → merge completion (1c). Phases 2 (writing skill), 3 (QA agent), 4 (UI) remain as separate brainstorm→spec→plan cycles.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `MergeEvent` (`{branch, prNumber, prUrl}`) is produced by `parseMergeEvent` (Task 1) and consumed in Task 3. `findRunByBranch`/`markPrMerged` (Task 2) signatures match their use in Task 3. `applyRunOutcome`'s `outcome` shape (`{status, prMerged, prUrl}`) matches `RunOutcome` from 1b. `buildTeamStateMap`/`upsertTeamMapping` (Task 5) match the CLI calls (Task 6). `StateMap` keys `inProgress`/`inReview`/`done` are consistent with 1a/1b. `FakeLinearGateway.states`/`stateUpdates` and `FakePtySpawner.lastHandle.emitExit` used in Tasks 5/7 exist from 1b.

**Note for the implementer:** `lo linear bootstrap` and `lo linear states` use `getLinearGateway()`, which reads `LINEAR_API_KEY` from the environment. Unlike the Next.js server, `tsx bin/lo.ts` does not auto-load `.env.local` — the smoke-test doc shows exporting it first. The Linear-webhook handler (1a) and this GitHub-webhook handler both verify HMAC before parsing, consistent with the established trust boundary.
