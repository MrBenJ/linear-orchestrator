import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/helpers/testDb";
import { makeTestConfig } from "../../test/helpers/testConfig";
import { FakePtySpawner } from "../../test/helpers/fakePty";
import { createTicketAndRun, claimNextQueuedRun, getRunWithTicket, markTerminal } from "@/runs/service";
import { readLogs } from "@/runs/logs";
import { spawnAgent } from "./spawnAgent";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: "proj-1", repoPath: "/tmp/r", harness: "claude-code", prompt: "do it", metadata: null,
  });
  const run = claimNextQueuedRun(db)!;
  return { db, runId, run };
}

const deps = (pty: FakePtySpawner) => ({
  pty,
  createWorktree: () => ({ worktreePath: "/wt/r1", branchName: "lo/ENG-1-abc" }),
  fetchOrigin: () => {},
  callbackBaseUrl: "http://localhost:3000/api/runs",
  baseEnv: {} as NodeJS.ProcessEnv,
});

describe("spawnAgent", () => {
  it("creates worktree, sets pid + token, captures output to logs", () => {
    const { db, runId, run } = setup();
    const pty = new FakePtySpawner();
    spawnAgent(db, run, getRunWithTicket(db, runId)!.ticket, makeTestConfig(), deps(pty));

    const after = getRunWithTicket(db, runId)!.run;
    expect(after.worktreePath).toBe("/wt/r1");
    expect(after.pid).toBe(9999);
    expect(after.callbackToken).toBeTruthy();
    expect(pty.lastSpawn?.file).toBe("claude-code");
    expect(pty.lastSpawn?.args).toContain("--dangerously-skip-permissions");

    pty.lastHandle!.emitData("agent says hi");
    pty.lastHandle!.emitExit(0);
    expect(readLogs(db, runId).map((l) => l.text).join("")).toContain("agent says hi");
  });

  it("marks the run failed when the agent exits without a status callback", () => {
    const { db, runId, run } = setup();
    const pty = new FakePtySpawner();
    spawnAgent(db, run, getRunWithTicket(db, runId)!.ticket, makeTestConfig(), deps(pty));
    pty.lastHandle!.emitExit(0);

    const after = getRunWithTicket(db, runId)!.run;
    expect(after.status).toBe("failed");
    expect(after.failureReason).toMatch(/without status callback/i);
  });

  it("does NOT override a status already set by the completion callback", () => {
    const { db, runId, run } = setup();
    const pty = new FakePtySpawner();
    spawnAgent(db, run, getRunWithTicket(db, runId)!.ticket, makeTestConfig(), deps(pty));
    markTerminal(db, runId, "completed", { exitCode: 0 });
    pty.lastHandle!.emitExit(0);

    expect(getRunWithTicket(db, runId)!.run.status).toBe("completed");
  });
});
