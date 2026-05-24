import { describe, it, expect } from "vitest";
import { handleListRuns, handleGetRun, handleGetLogs } from "./readHandlers";
import { makeTestDb } from "../../../../test/helpers/testDb";
import { createTicketAndRun, claimNextQueuedRun } from "@/runs/service";
import { appendLog } from "@/runs/logs";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  return { db, runId };
}

describe("read handlers", () => {
  it("lists active runs", async () => {
    const { db, runId } = setup();
    const res = await handleListRuns({ db });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runs.map((r: { id: string }) => r.id)).toContain(runId);
  });

  it("gets a single run, 404 for unknown", async () => {
    const { db, runId } = setup();
    expect((await handleGetRun(runId, { db })).status).toBe(200);
    expect((await handleGetRun("ghost", { db })).status).toBe(404);
  });

  it("returns logs from a seq offset", async () => {
    const { db, runId } = setup();
    appendLog(db, runId, 0, "stdout", Buffer.from("a"));
    appendLog(db, runId, 1, "stdout", Buffer.from("b"));
    const res = await handleGetLogs(runId, 1, { db });
    const json = await res.json();
    expect(json.logs.map((l: { text: string }) => l.text).join("")).toBe("b");
  });
});
