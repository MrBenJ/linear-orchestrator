# Phase 1a: Foundation & Intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Linear Orchestrator skeleton so that `POST /api/tickets` creates a Linear issue, transitions it to the team's mapped "in progress" state, and records a queued run in SQLite — with no agent worker yet.

**Architecture:** Next.js (App Router) for HTTP, SQLite via Drizzle ORM for state, a thin `LinearGateway` interface wrapping `@linear/sdk` (so handlers are testable with a fake), and per-team workflow-state mapping resolved from a config file. Route handlers are thin adapters that delegate to dependency-injected handler functions.

**Tech Stack:** TypeScript, Next.js 15, better-sqlite3 + drizzle-orm, @linear/sdk, zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-22-phase-1-lo-core-and-agent-runner-design.md`

**Scope of 1a:** scaffold · DB schema/client · config loader · Linear gateway · state mapping/bootstrap helpers · `POST /api/tickets` · `POST /api/webhooks/linear`. The worker, node-pty, status callbacks, CLI, and GitHub webhook are in plans 1b/1c.

---

## File structure (created by this plan)

```
package.json · tsconfig.json · next.config.js · vitest.config.ts · drizzle.config.ts · .gitignore
src/
  db/schema.ts · db/client.ts
  config/types.ts · config/index.ts
  linear/gateway.ts · linear/client.ts · linear/stateMapping.ts · linear/webhook.ts
  runs/service.ts
  app/api/tickets/route.ts · app/api/tickets/handler.ts
  app/api/webhooks/linear/route.ts · app/api/webhooks/linear/handler.ts
drizzle/                      (generated migration SQL)
test/helpers/testDb.ts · test/helpers/fakeLinear.ts · test/helpers/testConfig.ts
```

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.js`, `vitest.config.ts`, `drizzle.config.ts`, `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "linear-orchestrator",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@linear/sdk": "^39.0.0",
    "better-sqlite3": "^11.8.0",
    "drizzle-orm": "^0.38.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "@types/react": "^19.0.0",
    "drizzle-kit": "^0.30.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vite-tsconfig-paths": "^5.1.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "preserve",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["src", "test", "bin", "next-env.d.ts", ".next/types/**/*.ts", "*.config.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `next.config.js`** (keep native modules out of the bundle)

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
});
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
.next/
*.tsbuildinfo
next-env.d.ts
.env*.local
*.db
*.db-*
```

- [ ] **Step 7: Install dependencies**

Run: `pnpm install`
Expected: completes without error; `node_modules/` populated. (better-sqlite3 compiles a native binding — expect a build step.)

- [ ] **Step 8: Verify typecheck runs**

Run: `pnpm typecheck`
Expected: PASS (no errors). It is fine that there are no source files yet.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json next.config.js vitest.config.ts drizzle.config.ts .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold Next.js + Drizzle + Vitest project"
```

---

## Task 2: Database schema, client, and first migration

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `test/helpers/testDb.ts`
- Test: `src/db/client.test.ts`

- [ ] **Step 1: Create `src/db/schema.ts`**

```ts
import { sqliteTable, text, integer, blob, index } from "drizzle-orm/sqlite-core";

export const tickets = sqliteTable("tickets", {
  id: text("id").primaryKey(),
  linearIssueId: text("linear_issue_id").notNull().unique(),
  linearIdentifier: text("linear_identifier").notNull(),
  linearTeamId: text("linear_team_id").notNull(),
  linearProjectId: text("linear_project_id"),
  repoPath: text("repo_path").notNull(),
  harness: text("harness").notNull(),
  prompt: text("prompt").notNull(),
  metadata: text("metadata"),
  createdAt: integer("created_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull().references(() => tickets.id),
  status: text("status").notNull(),
  worktreePath: text("worktree_path"),
  branchName: text("branch_name"),
  pid: integer("pid"),
  startedAt: integer("started_at"),
  lastHeartbeatAt: integer("last_heartbeat_at"),
  completedAt: integer("completed_at"),
  exitCode: integer("exit_code"),
  result: text("result"),
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  prState: text("pr_state"),
  failureReason: text("failure_reason"),
  callbackToken: text("callback_token"),
  createdAt: integer("created_at").notNull(),
});

export const agentLogs = sqliteTable(
  "agent_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id").notNull().references(() => runs.id),
    seq: integer("seq").notNull(),
    ts: integer("ts").notNull(),
    stream: text("stream").notNull(),
    chunk: blob("chunk").notNull(),
  },
  (t) => ({ runSeqIdx: index("agent_logs_run_seq").on(t.runId, t.seq) }),
);

export const configRow = sqliteTable("config", {
  id: integer("id").primaryKey(),
  concurrencyCap: integer("concurrency_cap").notNull(),
  defaultRunTimeoutMs: integer("default_run_timeout_ms").notNull(),
  heartbeatIntervalMs: integer("heartbeat_interval_ms").notNull(),
  heartbeatGraceMs: integer("heartbeat_grace_ms").notNull(),
  projectMappings: text("project_mappings").notNull(),
  teamMappings: text("team_mappings").notNull(),
  orchestrationLabels: text("orchestration_labels").notNull(),
});
```

- [ ] **Step 2: Create `src/db/client.ts`**

```ts
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

const MIGRATIONS_FOLDER = join(process.cwd(), "drizzle");

export function createDb(dbPath: string): DB {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

let cached: DB | undefined;

export function getDb(): DB {
  if (!cached) {
    const home = process.env.HOME ?? process.cwd();
    const dbPath = process.env.LO_DB_PATH ?? join(home, ".linear-orchestrator", "state.db");
    cached = createDb(dbPath);
  }
  return cached;
}
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file under `drizzle/` (e.g. `drizzle/0000_*.sql`) plus `drizzle/meta/`. This SQL is what `createDb` applies.

- [ ] **Step 4: Create `test/helpers/testDb.ts`**

```ts
import { createDb, type DB } from "@/db/client";

export function makeTestDb(): DB {
  return createDb(":memory:");
}
```

- [ ] **Step 5: Write the failing test** in `src/db/client.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../test/helpers/testDb";
import { tickets } from "./schema";

describe("createDb", () => {
  it("creates tables and round-trips a ticket", () => {
    const db = makeTestDb();
    db.insert(tickets)
      .values({
        id: "t1",
        linearIssueId: "issue-1",
        linearIdentifier: "ENG-1",
        linearTeamId: "team-1",
        linearProjectId: "proj-1",
        repoPath: "/tmp/repo",
        harness: "claude-code",
        prompt: "do the thing",
        metadata: null,
        createdAt: 123,
      })
      .run();

    const row = db.select().from(tickets).where(eq(tickets.id, "t1")).get();
    expect(row?.linearIdentifier).toBe("ENG-1");
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test src/db/client.test.ts`
Expected: PASS. (If it fails with "no such table", re-run Step 3 — the migration folder must exist.)

- [ ] **Step 7: Commit**

```bash
git add src/db drizzle test/helpers/testDb.ts
git commit -m "feat: add Drizzle schema, db client, and first migration"
```

---

## Task 3: Config types and loader

**Files:**
- Create: `src/config/types.ts`, `src/config/index.ts`, `test/helpers/testConfig.ts`
- Test: `src/config/index.test.ts`

- [ ] **Step 1: Create `src/config/types.ts`**

```ts
import { z } from "zod";

export const projectMappingSchema = z.object({
  linearProjectId: z.string(),
  repoPath: z.string(),
});

export const stateMapSchema = z.object({
  inProgress: z.string(),
  inReview: z.string(),
  done: z.string(),
});

export const teamMappingSchema = z.object({
  linearTeamId: z.string(),
  stateMap: stateMapSchema,
});

export const orchestrationLabelsSchema = z.object({
  needsHuman: z.string().default("lo:needs-human"),
});

export const configSchema = z.object({
  concurrencyCap: z.number().int().positive().default(2),
  defaultRunTimeoutMs: z.number().int().positive().default(3_600_000),
  heartbeatIntervalMs: z.number().int().positive().default(300_000),
  heartbeatGraceMs: z.number().int().positive().default(600_000),
  projectMappings: z.array(projectMappingSchema).default([]),
  teamMappings: z.array(teamMappingSchema).default([]),
  orchestrationLabels: orchestrationLabelsSchema.default({ needsHuman: "lo:needs-human" }),
});

export type Config = z.infer<typeof configSchema>;
export type StateMap = z.infer<typeof stateMapSchema>;
export type ProjectMapping = z.infer<typeof projectMappingSchema>;
export type TeamMapping = z.infer<typeof teamMappingSchema>;
```

- [ ] **Step 2: Create `src/config/index.ts`**

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configSchema, type Config, type StateMap } from "./types";

export function parseConfig(json: unknown): Config {
  return configSchema.parse(json);
}

export function loadConfig(filePath: string): Config {
  return parseConfig(JSON.parse(readFileSync(filePath, "utf8")));
}

export function resolveRepoPath(config: Config, linearProjectId: string | null): string | undefined {
  if (!linearProjectId) return undefined;
  return config.projectMappings.find((m) => m.linearProjectId === linearProjectId)?.repoPath;
}

export function resolveStateMap(config: Config, linearTeamId: string): StateMap | undefined {
  return config.teamMappings.find((m) => m.linearTeamId === linearTeamId)?.stateMap;
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (!cached) {
    const home = process.env.HOME ?? process.cwd();
    const path = process.env.LO_CONFIG_PATH ?? join(home, ".linear-orchestrator", "config.json");
    cached = loadConfig(path);
  }
  return cached;
}

export type { Config, StateMap } from "./types";
```

- [ ] **Step 3: Create `test/helpers/testConfig.ts`**

```ts
import { parseConfig, type Config } from "@/config";

export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  return parseConfig({
    projectMappings: [{ linearProjectId: "proj-1", repoPath: "/tmp/repo" }],
    teamMappings: [
      { linearTeamId: "team-1", stateMap: { inProgress: "s-prog", inReview: "s-rev", done: "s-done" } },
    ],
    ...overrides,
  });
}
```

- [ ] **Step 4: Write the failing test** in `src/config/index.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseConfig, resolveRepoPath, resolveStateMap } from "./index";
import { makeTestConfig } from "../../test/helpers/testConfig";

describe("config", () => {
  it("applies defaults for omitted fields", () => {
    const c = parseConfig({});
    expect(c.concurrencyCap).toBe(2);
    expect(c.defaultRunTimeoutMs).toBe(3_600_000);
    expect(c.orchestrationLabels.needsHuman).toBe("lo:needs-human");
  });

  it("resolves repo path from project mapping", () => {
    const c = makeTestConfig();
    expect(resolveRepoPath(c, "proj-1")).toBe("/tmp/repo");
    expect(resolveRepoPath(c, "unknown")).toBeUndefined();
    expect(resolveRepoPath(c, null)).toBeUndefined();
  });

  it("resolves state map from team mapping", () => {
    const c = makeTestConfig();
    expect(resolveStateMap(c, "team-1")?.inProgress).toBe("s-prog");
    expect(resolveStateMap(c, "unknown")).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/config/index.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config test/helpers/testConfig.ts
git commit -m "feat: add config schema, loader, and mapping resolvers"
```

---

## Task 4: Linear gateway (interface + SDK implementation + fake)

**Files:**
- Create: `src/linear/gateway.ts`, `src/linear/client.ts`, `test/helpers/fakeLinear.ts`
- Test: `test/helpers/fakeLinear.test.ts`

- [ ] **Step 1: Create `src/linear/gateway.ts`** (the interface every consumer depends on)

```ts
export type WorkflowStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export interface WorkflowState {
  id: string;
  name: string;
  type: WorkflowStateType;
  position: number;
}

export interface CreateIssueInput {
  teamId: string;
  title: string;
  description?: string;
  projectId?: string;
  stateId?: string;
  labelIds?: string[];
}

export interface CreatedIssue {
  id: string;
  identifier: string;
  url: string;
}

export interface LinearGateway {
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
  listWorkflowStates(teamId: string): Promise<WorkflowState[]>;
  updateIssueState(issueId: string, stateId: string): Promise<void>;
  ensureLabel(teamId: string, name: string): Promise<string>;
  addLabelToIssue(issueId: string, labelId: string): Promise<void>;
  createComment(issueId: string, body: string): Promise<void>;
}
```

- [ ] **Step 2: Create `src/linear/client.ts`** (the real implementation over `@linear/sdk`)

```ts
import { LinearClient as LinearSdk } from "@linear/sdk";
import type {
  CreateIssueInput,
  CreatedIssue,
  LinearGateway,
  WorkflowState,
  WorkflowStateType,
} from "./gateway";

export class LinearSdkGateway implements LinearGateway {
  constructor(private readonly sdk: LinearSdk) {}

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    const payload = await this.sdk.createIssue(input);
    const issue = await payload.issue;
    if (!issue) throw new Error("createIssue returned no issue");
    return { id: issue.id, identifier: issue.identifier, url: issue.url };
  }

  async listWorkflowStates(teamId: string): Promise<WorkflowState[]> {
    const conn = await this.sdk.workflowStates({ filter: { team: { id: { eq: teamId } } } });
    return conn.nodes.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type as WorkflowStateType,
      position: s.position,
    }));
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.sdk.updateIssue(issueId, { stateId });
  }

  async ensureLabel(teamId: string, name: string): Promise<string> {
    const existing = await this.sdk.issueLabels({
      filter: { team: { id: { eq: teamId } }, name: { eq: name } },
    });
    if (existing.nodes.length > 0) return existing.nodes[0].id;
    const payload = await this.sdk.createIssueLabel({ teamId, name });
    const label = await payload.issueLabel;
    if (!label) throw new Error("createIssueLabel returned no label");
    return label.id;
  }

  async addLabelToIssue(issueId: string, labelId: string): Promise<void> {
    const issue = await this.sdk.issue(issueId);
    const labels = await issue.labels();
    const ids = labels.nodes.map((l) => l.id);
    if (ids.includes(labelId)) return;
    await this.sdk.updateIssue(issueId, { labelIds: [...ids, labelId] });
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.sdk.createComment({ issueId, body });
  }
}

let cached: LinearGateway | undefined;

export function getLinearGateway(): LinearGateway {
  if (!cached) {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) throw new Error("LINEAR_API_KEY is not set");
    cached = new LinearSdkGateway(new LinearSdk({ apiKey }));
  }
  return cached;
}
```

- [ ] **Step 3: Create `test/helpers/fakeLinear.ts`** (used by handler tests in later tasks)

```ts
import type {
  CreateIssueInput,
  CreatedIssue,
  LinearGateway,
  WorkflowState,
} from "@/linear/gateway";

export class FakeLinearGateway implements LinearGateway {
  createdIssues: CreateIssueInput[] = [];
  stateUpdates: Array<{ issueId: string; stateId: string }> = [];
  labelAdds: Array<{ issueId: string; labelId: string }> = [];
  comments: Array<{ issueId: string; body: string }> = [];
  states: WorkflowState[] = [];
  nextIssue: CreatedIssue = {
    id: "issue-1",
    identifier: "ENG-1",
    url: "https://linear.app/acme/issue/ENG-1",
  };
  failCreate = false;

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    if (this.failCreate) throw new Error("simulated Linear failure");
    this.createdIssues.push(input);
    return this.nextIssue;
  }
  async listWorkflowStates(): Promise<WorkflowState[]> {
    return this.states;
  }
  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    this.stateUpdates.push({ issueId, stateId });
  }
  async ensureLabel(_teamId: string, name: string): Promise<string> {
    return `label-${name}`;
  }
  async addLabelToIssue(issueId: string, labelId: string): Promise<void> {
    this.labelAdds.push({ issueId, labelId });
  }
  async createComment(issueId: string, body: string): Promise<void> {
    this.comments.push({ issueId, body });
  }
}
```

- [ ] **Step 4: Write the failing test** in `test/helpers/fakeLinear.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { FakeLinearGateway } from "./fakeLinear";

describe("FakeLinearGateway", () => {
  it("records createIssue calls and returns the configured issue", async () => {
    const fake = new FakeLinearGateway();
    const issue = await fake.createIssue({ teamId: "team-1", title: "x" });
    expect(issue.identifier).toBe("ENG-1");
    expect(fake.createdIssues).toHaveLength(1);
  });

  it("throws when failCreate is set", async () => {
    const fake = new FakeLinearGateway();
    fake.failCreate = true;
    await expect(fake.createIssue({ teamId: "team-1", title: "x" })).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test test/helpers/fakeLinear.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify the real gateway typechecks against the SDK**

Run: `pnpm typecheck`
Expected: PASS. (This is the real check on Step 2 — the SDK method signatures must line up.)

- [ ] **Step 7: Commit**

```bash
git add src/linear/gateway.ts src/linear/client.ts test/helpers/fakeLinear.ts test/helpers/fakeLinear.test.ts
git commit -m "feat: add LinearGateway interface, SDK implementation, and fake"
```

---

## Task 5: State mapping / bootstrap helpers

**Files:**
- Create: `src/linear/stateMapping.ts`
- Test: `src/linear/stateMapping.test.ts`

- [ ] **Step 1: Write the failing test** in `src/linear/stateMapping.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { proposeStateMap, validateStateMap } from "./stateMapping";
import type { WorkflowState } from "./gateway";

const states: WorkflowState[] = [
  { id: "backlog", name: "Backlog", type: "backlog", position: 0 },
  { id: "todo", name: "Todo", type: "unstarted", position: 1 },
  { id: "dev", name: "In Dev", type: "started", position: 2 },
  { id: "review", name: "Code Review", type: "started", position: 3 },
  { id: "shipped", name: "Shipped", type: "completed", position: 4 },
];

describe("proposeStateMap", () => {
  it("maps inProgress/inReview/done by type and position", () => {
    const { stateMap, warnings } = proposeStateMap(states);
    expect(stateMap).toEqual({ inProgress: "dev", inReview: "review", done: "shipped" });
    expect(warnings).toHaveLength(0);
  });

  it("falls back inReview to inProgress when only one started state exists", () => {
    const single = states.filter((s) => s.id !== "review");
    const { stateMap, warnings } = proposeStateMap(single);
    expect(stateMap.inReview).toBe("dev");
    expect(warnings.join(" ")).toContain("inReview falls back");
  });
});

describe("validateStateMap", () => {
  it("throws when a state id is not a known workflow state", () => {
    expect(() =>
      validateStateMap({ inProgress: "dev", inReview: "review", done: "ghost" }, states),
    ).toThrow(/done/);
  });

  it("passes for a fully-resolved valid map", () => {
    expect(() =>
      validateStateMap({ inProgress: "dev", inReview: "review", done: "shipped" }, states),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/linear/stateMapping.test.ts`
Expected: FAIL with "Cannot find module './stateMapping'".

- [ ] **Step 3: Create `src/linear/stateMapping.ts`**

```ts
import type { StateMap } from "@/config/types";
import type { WorkflowState, WorkflowStateType } from "./gateway";

export interface ProposedStateMap {
  stateMap: Partial<StateMap>;
  warnings: string[];
}

export function proposeStateMap(states: WorkflowState[]): ProposedStateMap {
  const byType = (t: WorkflowStateType) =>
    states.filter((s) => s.type === t).sort((a, b) => a.position - b.position);

  const started = byType("started");
  const completed = byType("completed");
  const warnings: string[] = [];

  const inProgress = started[0]?.id;
  const done = completed[0]?.id;
  let inReview = started[1]?.id;

  if (!inProgress) warnings.push('No "started"-type state found for inProgress.');
  if (!done) warnings.push('No "completed"-type state found for done.');
  if (!inReview && inProgress) {
    inReview = inProgress;
    warnings.push('No second "started" state; inReview falls back to inProgress.');
  }

  return { stateMap: { inProgress, inReview, done }, warnings };
}

export function validateStateMap(
  stateMap: Partial<StateMap>,
  states: WorkflowState[],
): asserts stateMap is StateMap {
  const ids = new Set(states.map((s) => s.id));
  for (const key of ["inProgress", "inReview", "done"] as const) {
    const id = stateMap[key];
    if (!id) throw new Error(`stateMap.${key} is not set`);
    if (!ids.has(id)) {
      throw new Error(`stateMap.${key} (${id}) is not a known workflow state for this team`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/linear/stateMapping.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/linear/stateMapping.ts src/linear/stateMapping.test.ts
git commit -m "feat: add workflow state proposal and validation helpers"
```

---

## Task 6: Run service (intake persistence)

**Files:**
- Create: `src/runs/service.ts`
- Test: `src/runs/service.test.ts`

- [ ] **Step 1: Write the failing test** in `src/runs/service.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../test/helpers/testDb";
import { createTicketAndRun, getRun } from "./service";
import { tickets, runs } from "@/db/schema";

const input = {
  linearIssueId: "issue-1",
  linearIdentifier: "ENG-1",
  linearTeamId: "team-1",
  linearProjectId: "proj-1" as string | null,
  repoPath: "/tmp/repo",
  harness: "claude-code",
  prompt: "do it",
  metadata: { title: "t" },
};

describe("createTicketAndRun", () => {
  it("inserts a ticket and a queued run in one transaction", () => {
    const db = makeTestDb();
    const { ticketId, runId } = createTicketAndRun(db, input);

    const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    expect(ticket?.linearIssueId).toBe("issue-1");
    expect(ticket?.metadata).toBe(JSON.stringify({ title: "t" }));

    const run = getRun(db, runId);
    expect(run?.status).toBe("queued");
    expect(run?.ticketId).toBe(ticketId);
  });

  it("rolls back the ticket if the run insert fails (duplicate issue id)", () => {
    const db = makeTestDb();
    createTicketAndRun(db, input);
    // second insert with the same linearIssueId violates the unique constraint
    expect(() => createTicketAndRun(db, input)).toThrow();
    const all = db.select().from(runs).all();
    expect(all).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/runs/service.test.ts`
Expected: FAIL with "Cannot find module './service'".

- [ ] **Step 3: Create `src/runs/service.ts`**

```ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { tickets, runs } from "@/db/schema";

export interface NewTicketInput {
  linearIssueId: string;
  linearIdentifier: string;
  linearTeamId: string;
  linearProjectId: string | null;
  repoPath: string;
  harness: string;
  prompt: string;
  metadata: unknown;
}

export interface CreatedTicketRun {
  ticketId: string;
  runId: string;
}

export function createTicketAndRun(db: DB, input: NewTicketInput): CreatedTicketRun {
  const ticketId = randomUUID();
  const runId = randomUUID();
  const now = Date.now();

  db.transaction((tx) => {
    tx.insert(tickets)
      .values({
        id: ticketId,
        linearIssueId: input.linearIssueId,
        linearIdentifier: input.linearIdentifier,
        linearTeamId: input.linearTeamId,
        linearProjectId: input.linearProjectId,
        repoPath: input.repoPath,
        harness: input.harness,
        prompt: input.prompt,
        metadata: JSON.stringify(input.metadata ?? null),
        createdAt: now,
      })
      .run();

    tx.insert(runs)
      .values({ id: runId, ticketId, status: "queued", createdAt: now })
      .run();
  });

  return { ticketId, runId };
}

export function getRun(db: DB, runId: string) {
  return db.select().from(runs).where(eq(runs.id, runId)).get();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/runs/service.test.ts`
Expected: PASS (2 tests). (The rollback test relies on `foreign_keys`/unique enforcement; better-sqlite3 transactions are synchronous and roll back on throw.)

- [ ] **Step 5: Commit**

```bash
git add src/runs/service.ts src/runs/service.test.ts
git commit -m "feat: add run service for ticket+run intake persistence"
```

---

## Task 7: `POST /api/tickets`

**Files:**
- Create: `src/app/api/tickets/handler.ts`, `src/app/api/tickets/route.ts`
- Test: `src/app/api/tickets/handler.test.ts`

- [ ] **Step 1: Write the failing test** in `src/app/api/tickets/handler.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { handleCreateTickets } from "./handler";
import { makeTestDb } from "../../../../test/helpers/testDb";
import { makeTestConfig } from "../../../../test/helpers/testConfig";
import { FakeLinearGateway } from "../../../../test/helpers/fakeLinear";
import { tickets, runs } from "@/db/schema";

function post(body: unknown): Request {
  return new Request("http://localhost/api/tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validTicket = {
  linearTeamId: "team-1",
  linearProjectId: "proj-1",
  title: "Add foo",
  description: "desc",
  acceptanceCriteria: ["does foo"],
  prompt: "implement foo",
  harness: "claude-code",
};

describe("handleCreateTickets", () => {
  it("creates the issue, persists ticket+run, and transitions to inProgress", async () => {
    const db = makeTestDb();
    const config = makeTestConfig();
    const linear = new FakeLinearGateway();

    const res = await handleCreateTickets(post({ tickets: [validTicket] }), { db, config, linear });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tickets[0].linearIdentifier).toBe("ENG-1");

    expect(linear.createdIssues).toHaveLength(1);
    expect(linear.stateUpdates).toEqual([{ issueId: "issue-1", stateId: "s-prog" }]);

    const ticketRow = db.select().from(tickets).where(eq(tickets.linearIssueId, "issue-1")).get();
    expect(ticketRow?.repoPath).toBe("/tmp/repo");
    const runRow = db.select().from(runs).where(eq(runs.ticketId, ticketRow!.id)).get();
    expect(runRow?.status).toBe("queued");
  });

  it("rejects an unknown team with 400 and persists nothing", async () => {
    const db = makeTestDb();
    const linear = new FakeLinearGateway();
    const res = await handleCreateTickets(
      post({ tickets: [{ ...validTicket, linearTeamId: "ghost" }] }),
      { db, config: makeTestConfig(), linear },
    );
    expect(res.status).toBe(400);
    expect(linear.createdIssues).toHaveLength(0);
    expect(db.select().from(tickets).all()).toHaveLength(0);
  });

  it("rejects an unknown project with 400", async () => {
    const db = makeTestDb();
    const linear = new FakeLinearGateway();
    const res = await handleCreateTickets(
      post({ tickets: [{ ...validTicket, linearProjectId: "ghost" }] }),
      { db, config: makeTestConfig(), linear },
    );
    expect(res.status).toBe(400);
    expect(linear.createdIssues).toHaveLength(0);
  });

  it("returns 400 on a malformed body", async () => {
    const db = makeTestDb();
    const res = await handleCreateTickets(post({ nope: true }), {
      db,
      config: makeTestConfig(),
      linear: new FakeLinearGateway(),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/app/api/tickets/handler.test.ts`
Expected: FAIL with "Cannot find module './handler'".

- [ ] **Step 3: Create `src/app/api/tickets/handler.ts`**

```ts
import { z } from "zod";
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { resolveRepoPath, resolveStateMap } from "@/config";
import type { LinearGateway } from "@/linear/gateway";
import { createTicketAndRun } from "@/runs/service";

const ticketInputSchema = z.object({
  linearTeamId: z.string().min(1),
  linearProjectId: z.string().min(1).optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  prompt: z.string().min(1),
  harness: z.literal("claude-code"),
  labels: z.array(z.string()).optional(),
});

const bodySchema = z.object({ tickets: z.array(ticketInputSchema).min(1) });

export interface TicketsDeps {
  db: DB;
  config: Config;
  linear: LinearGateway;
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function composeDescription(description: string | undefined, ac: string[] | undefined): string {
  const parts: string[] = [];
  if (description) parts.push(description);
  if (ac && ac.length > 0) {
    parts.push(["## Acceptance criteria", ...ac.map((a) => `- ${a}`)].join("\n"));
  }
  return parts.join("\n\n");
}

export async function handleCreateTickets(req: Request, deps: TicketsDeps): Promise<Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  // Pre-validate every ticket's mappings BEFORE creating anything (atomic intake).
  const resolved = [];
  for (const t of parsed.data.tickets) {
    const stateMap = resolveStateMap(deps.config, t.linearTeamId);
    if (!stateMap) return json({ error: `no state mapping for team ${t.linearTeamId}` }, 400);
    const repoPath = resolveRepoPath(deps.config, t.linearProjectId ?? null);
    if (!repoPath) {
      return json({ error: `no repo mapping for project ${t.linearProjectId ?? "(none)"}` }, 400);
    }
    resolved.push({ t, stateMap, repoPath });
  }

  const results = [];
  for (const { t, stateMap, repoPath } of resolved) {
    const issue = await deps.linear.createIssue({
      teamId: t.linearTeamId,
      projectId: t.linearProjectId,
      title: t.title,
      description: composeDescription(t.description, t.acceptanceCriteria),
    });

    const { ticketId, runId } = createTicketAndRun(deps.db, {
      linearIssueId: issue.id,
      linearIdentifier: issue.identifier,
      linearTeamId: t.linearTeamId,
      linearProjectId: t.linearProjectId ?? null,
      repoPath,
      harness: t.harness,
      prompt: t.prompt,
      metadata: {
        title: t.title,
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        labels: t.labels,
      },
    });

    await deps.linear.updateIssueState(issue.id, stateMap.inProgress);
    results.push({
      id: ticketId,
      linearUrl: issue.url,
      linearIdentifier: issue.identifier,
      runId,
    });
  }

  return json({ tickets: results }, 200);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/app/api/tickets/handler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the thin route adapter** `src/app/api/tickets/route.ts`

```ts
import { handleCreateTickets } from "./handler";
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getLinearGateway } from "@/linear/client";

export async function POST(req: Request): Promise<Response> {
  return handleCreateTickets(req, {
    db: getDb(),
    config: getConfig(),
    linear: getLinearGateway(),
  });
}
```

- [ ] **Step 6: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/tickets
git commit -m "feat: add POST /api/tickets intake handler and route"
```

---

## Task 8: `POST /api/webhooks/linear`

**Files:**
- Create: `src/linear/webhook.ts`, `src/app/api/webhooks/linear/handler.ts`, `src/app/api/webhooks/linear/route.ts`
- Test: `src/linear/webhook.test.ts`, `src/app/api/webhooks/linear/handler.test.ts`

- [ ] **Step 1: Write the failing test** in `src/linear/webhook.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLinearSignature } from "./webhook";

const secret = "shh";
const body = JSON.stringify({ action: "update", type: "Issue" });
const sig = createHmac("sha256", secret).update(body).digest("hex");

describe("verifyLinearSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyLinearSignature(body, sig, secret)).toBe(true);
  });
  it("rejects a wrong signature", () => {
    expect(verifyLinearSignature(body, "deadbeef", secret)).toBe(false);
  });
  it("rejects a missing signature", () => {
    expect(verifyLinearSignature(body, null, secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/linear/webhook.test.ts`
Expected: FAIL with "Cannot find module './webhook'".

- [ ] **Step 3: Create `src/linear/webhook.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLinearSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/linear/webhook.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing handler test** in `src/app/api/webhooks/linear/handler.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleLinearWebhook } from "./handler";
import { makeTestDb } from "../../../../../test/helpers/testDb";

const secret = "shh";

function signedRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("http://localhost/api/webhooks/linear", {
    method: "POST",
    headers: { "linear-signature": sig },
    body,
  });
}

describe("handleLinearWebhook", () => {
  it("returns 200 for a correctly-signed event", async () => {
    const res = await handleLinearWebhook(signedRequest({ action: "update", type: "Issue" }), {
      db: makeTestDb(),
      webhookSecret: secret,
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 for a bad signature", async () => {
    const req = new Request("http://localhost/api/webhooks/linear", {
      method: "POST",
      headers: { "linear-signature": "wrong" },
      body: JSON.stringify({ action: "update", type: "Issue" }),
    });
    const res = await handleLinearWebhook(req, { db: makeTestDb(), webhookSecret: secret });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test src/app/api/webhooks/linear/handler.test.ts`
Expected: FAIL with "Cannot find module './handler'".

- [ ] **Step 7: Create `src/app/api/webhooks/linear/handler.ts`**

```ts
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { tickets } from "@/db/schema";
import { verifyLinearSignature } from "@/linear/webhook";

export interface LinearWebhookDeps {
  db: DB;
  webhookSecret: string;
}

export async function handleLinearWebhook(req: Request, deps: LinearWebhookDeps): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("linear-signature");
  if (!verifyLinearSignature(rawBody, signature, deps.webhookSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: { type?: string; data?: { id?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("ok", { status: 200 }); // acknowledge unparseable payloads
  }

  // Phase 1a: for tracked issues we only log the transition for audit. No action.
  if (event.type === "Issue" && event.data?.id) {
    const tracked = deps.db
      .select()
      .from(tickets)
      .where(eq(tickets.linearIssueId, event.data.id))
      .get();
    if (tracked) {
      console.log(`[linear-webhook] state change on tracked issue ${tracked.linearIdentifier}`);
    }
  }

  return new Response("ok", { status: 200 });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm test src/app/api/webhooks/linear/handler.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Create the thin route adapter** `src/app/api/webhooks/linear/route.ts`

```ts
import { handleLinearWebhook } from "./handler";
import { getDb } from "@/db/client";

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!webhookSecret) return new Response("LINEAR_WEBHOOK_SECRET not set", { status: 500 });
  return handleLinearWebhook(req, { db: getDb(), webhookSecret });
}
```

- [ ] **Step 10: Commit**

```bash
git add src/linear/webhook.ts src/linear/webhook.test.ts src/app/api/webhooks/linear
git commit -m "feat: add Linear webhook receiver with HMAC verification"
```

---

## Task 9: Full-suite verification and intake docs

**Files:**
- Create: `docs/setup.md`

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS — all tests from Tasks 2–8 green.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Create `docs/setup.md`** documenting the config + env needed to actually run intake

````markdown
# LO setup (Phase 1a)

## Secrets — `.env.local` (gitignored)

```
LINEAR_API_KEY=lin_api_...
LINEAR_WEBHOOK_SECRET=...
LO_PORT=3000
```

## Runtime config — `~/.linear-orchestrator/config.json`

```json
{
  "concurrencyCap": 2,
  "projectMappings": [
    { "linearProjectId": "<project-uuid>", "repoPath": "/Users/me/code/myproject" }
  ],
  "teamMappings": [
    {
      "linearTeamId": "<team-uuid>",
      "stateMap": {
        "inProgress": "<state-uuid>",
        "inReview": "<state-uuid>",
        "done": "<state-uuid>"
      }
    }
  ],
  "orchestrationLabels": { "needsHuman": "lo:needs-human" }
}
```

`lo linear bootstrap` (added in plan 1b) will propose `stateMap` values from your
team's workflow states. Until then, fill them in by hand from Linear's settings.

## Smoke check (manual)

1. `pnpm dev`
2. `curl -X POST localhost:3000/api/tickets -H 'content-type: application/json' -d '{"tickets":[{"linearTeamId":"<team>","linearProjectId":"<project>","title":"LO test","prompt":"noop","harness":"claude-code"}]}'`
3. Confirm a new Linear issue appears in your "in progress" state and the response returns its identifier.
````

- [ ] **Step 4: Commit**

```bash
git add docs/setup.md
git commit -m "docs: add Phase 1a setup and intake smoke check"
```

---

## Self-Review notes

**Spec coverage (1a slice):**
- Next.js App Router skeleton → Task 1 ✓
- SQLite + Drizzle store (all four tables, incl. `runs.pr_*` and `linear_team_id` from the revised spec) → Task 2 ✓
- Config loader incl. `teamMappings` + `orchestrationLabels` → Task 3 ✓
- Linear client (create issue, transition state, manage labels, comment) → Task 4 ✓
- State mapping / bootstrap rules (type+position, inReview fallback, validation) → Task 5 ✓
- Atomic ticket+run intake, run starts `queued` → Task 6 ✓
- `POST /api/tickets`: validate team+project up front (fail loud, nothing persisted), create issue, transition to mapped `inProgress` → Task 7 ✓
- `POST /api/webhooks/linear` with HMAC verification → Task 8 ✓

**Deferred to 1b/1c (intentionally not in this plan):** worker loop, worktree manager, node-pty spawn, prompt template, status callback + heartbeat APIs, timeout/heartbeat reaper, CLI (incl. `lo linear bootstrap`), GitHub webhook, end-to-end echo-agent integration test, smoke-test against real claude-code.

**Type consistency:** `LinearGateway` method names (`createIssue`, `listWorkflowStates`, `updateIssueState`, `ensureLabel`, `addLabelToIssue`, `createComment`) are identical across the interface (Task 4), the SDK impl (Task 4), the fake (Task 4), and the handler call sites (Task 7). `StateMap` keys (`inProgress`/`inReview`/`done`) match across config (Task 3), state mapping (Task 5), and the handler (Task 7). `createTicketAndRun`'s `NewTicketInput` matches the handler's call (Task 7).

**Note for the implementer:** `@linear/sdk` major versions occasionally rename filter shapes. If Task 4 Step 6 typecheck fails on `workflowStates({ filter })` or `issueLabels({ filter })`, check the installed SDK version's generated types and adjust the filter object — the gateway interface (and therefore every consumer) stays unchanged.
