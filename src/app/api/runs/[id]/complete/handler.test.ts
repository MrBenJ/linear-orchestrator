import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { handleComplete } from "./handler";
import { makeTestDb } from "../../../../../../test/helpers/testDb";
import { makeTestConfig } from "../../../../../../test/helpers/testConfig";
import { FakeLinearGateway } from "../../../../../../test/helpers/fakeLinear";
import { createTicketAndRun, claimNextQueuedRun, getRunWithTicket } from "@/runs/service";
import { runs } from "@/db/schema";

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
    const res = await handleComplete(req("tok", { status: "failure", summary: "boom" }), runId, { db, config, linear });
    expect(res.status).toBe(200);
    expect(getRunWithTicket(db, runId)!.run.status).toBe("failed");
    expect(linear.labelAdds).toEqual([{ issueId: "issue-1", labelId: "label-lo:needs-human" }]);
  });

  it("returns 404 for an unknown run", async () => {
    const { db, config, linear } = setup();
    const res = await handleComplete(req("tok", { status: "success", prMerged: true }), "ghost", { db, config, linear });
    expect(res.status).toBe(404);
  });

  it("keeps the run terminal and does not 500 when the Linear update fails", async () => {
    const { db, runId, config, linear } = setup();
    linear.failStateUpdate = true; // simulate Linear being down
    const res = await handleComplete(
      req("tok", { status: "success", prUrl: "https://github.com/o/r/pull/9", prMerged: true }),
      runId,
      { db, config, linear },
    );
    // The run genuinely finished; we must not 500 (which would invite a retry
    // that double-applies). The Linear-sync failure is recorded instead.
    expect(res.status).toBe(200);
    const { run } = getRunWithTicket(db, runId)!;
    expect(run.status).toBe("completed");
    expect(run.failureReason).toMatch(/linear sync failed/i);
  });
});
