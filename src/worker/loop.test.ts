import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../test/helpers/testDb";
import { makeTestConfig } from "../../test/helpers/testConfig";
import { createTicketAndRun, getRunWithTicket } from "@/runs/service";
import { runs } from "@/db/schema";
import { tick } from "./loop";

function seed(db: ReturnType<typeof makeTestDb>, issue: string) {
  return createTicketAndRun(db, {
    linearIssueId: issue, linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
}

describe("worker tick", () => {
  it("claims and spawns up to the concurrency cap, leaving the rest queued", () => {
    const db = makeTestDb();
    seed(db, "i1");
    seed(db, "i2");
    seed(db, "i3");
    const spawned: string[] = [];
    const cfg = makeTestConfig({ concurrencyCap: 2 });

    tick(db, cfg, { spawn: (run) => spawned.push(run.id), reap: () => {} });

    expect(spawned).toHaveLength(2);
    const queued = db.select().from(runs).where(eq(runs.status, "queued")).all();
    expect(queued).toHaveLength(1);
  });

  it("does not exceed the cap when runs are already running", () => {
    const db = makeTestDb();
    seed(db, "i1");
    const b = seed(db, "i2");
    const cfg = makeTestConfig({ concurrencyCap: 1 });

    tick(db, cfg, { spawn: () => {}, reap: () => {} }); // claims i1 -> running
    const spawned: string[] = [];
    tick(db, cfg, { spawn: (run) => spawned.push(run.id), reap: () => {} }); // cap full

    expect(spawned).toHaveLength(0);
    expect(getRunWithTicket(db, b.runId)!.run.status).toBe("queued");
  });

  it("invokes the reaper each tick", () => {
    const db = makeTestDb();
    const reap = vi.fn();
    tick(db, makeTestConfig(), { spawn: () => {}, reap });
    expect(reap).toHaveBeenCalledOnce();
  });
});
