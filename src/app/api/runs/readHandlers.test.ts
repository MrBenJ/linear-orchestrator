import { describe, it, expect } from "vitest";
import { handleListRuns, handleGetRun, handleGetLogs } from "./readHandlers";
import { makeTestDb } from "../../../../test/helpers/testDb";
import { createTicketAndRun, claimNextQueuedRun } from "@/runs/service";
import { appendLog } from "@/runs/logs";
import { runs } from "@/db/schema";
import { eq } from "drizzle-orm";

const TOKEN = "op-token";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  db.update(runs).set({ callbackToken: "super-secret" }).where(eq(runs.id, runId)).run();
  return { db, runId };
}

function req(auth: string | null = `Bearer ${TOKEN}`): Request {
  const headers: Record<string, string> = {};
  if (auth !== null) headers["authorization"] = auth;
  return new Request("http://localhost/api/runs", { headers });
}

describe("read handlers", () => {
  it("lists active runs with a valid token", async () => {
    const { db, runId } = setup();
    const res = await handleListRuns(req(), { db, apiToken: TOKEN });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runs.map((r: { id: string }) => r.id)).toContain(runId);
  });

  it("rejects unauthenticated reads with 401", async () => {
    const { db, runId } = setup();
    expect((await handleListRuns(req(null), { db, apiToken: TOKEN })).status).toBe(401);
    expect((await handleGetRun(req("Bearer nope"), runId, { db, apiToken: TOKEN })).status).toBe(401);
    expect((await handleGetLogs(req(null), runId, 0, { db, apiToken: TOKEN })).status).toBe(401);
  });

  it("gets a single run, 404 for unknown, and never leaks callbackToken", async () => {
    const { db, runId } = setup();
    const res = await handleGetRun(req(), runId, { db, apiToken: TOKEN });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.run.callbackToken).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain("super-secret");
    expect((await handleGetRun(req(), "ghost", { db, apiToken: TOKEN })).status).toBe(404);
  });

  it("returns logs from a seq offset", async () => {
    const { db, runId } = setup();
    appendLog(db, runId, 0, "stdout", Buffer.from("a"));
    appendLog(db, runId, 1, "stdout", Buffer.from("b"));
    const res = await handleGetLogs(req(), runId, 1, { db, apiToken: TOKEN });
    const json = await res.json();
    expect(json.logs.map((l: { text: string }) => l.text).join("")).toBe("b");
  });
});
