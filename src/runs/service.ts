import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
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

/** Active (non-terminal) runs, oldest first. */
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
