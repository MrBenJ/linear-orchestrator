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
  cancelRequested: integer("cancel_requested").notNull().default(0),
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
