import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import {
  createTicketAndRun,
  claimNextQueuedRun,
  setWorktree,
  findRunByBranch,
  markPrMerged,
  getRunWithTicket,
} from "./service";

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
