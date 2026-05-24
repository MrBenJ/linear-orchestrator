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
