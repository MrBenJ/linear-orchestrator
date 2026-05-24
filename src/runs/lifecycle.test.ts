import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import {
  createTicketAndRun,
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
