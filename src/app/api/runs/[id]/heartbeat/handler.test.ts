import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { handleHeartbeat } from "./handler";
import { makeTestDb } from "../../../../../../test/helpers/testDb";
import { createTicketAndRun, claimNextQueuedRun, getRunWithTicket } from "@/runs/service";
import { runs } from "@/db/schema";

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
