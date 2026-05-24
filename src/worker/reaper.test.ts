import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../test/helpers/testDb";
import { makeTestConfig } from "../../test/helpers/testConfig";
import {
  createTicketAndRun,
  claimNextQueuedRun,
  markRunning,
  touchHeartbeat,
  requestCancel,
  markTerminal,
  getRunWithTicket,
} from "@/runs/service";
import { runs } from "@/db/schema";
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

  it("kills a leftover process for an already-terminal run", () => {
    const db = makeTestDb();
    const runId = runningRun(db, "i1");
    markTerminal(db, runId, "completed", { exitCode: 0 });
    const killed: number[] = [];

    reapRuns(db, makeTestConfig(), { now: Date.now(), kill: (pid) => killed.push(pid) });

    expect(killed).toEqual([1234]);
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
