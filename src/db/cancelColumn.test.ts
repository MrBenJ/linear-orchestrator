import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../test/helpers/testDb";
import { tickets, runs } from "./schema";

describe("runs.cancelRequested", () => {
  it("defaults to 0 and can be set to 1", () => {
    const db = makeTestDb();
    db.insert(tickets).values({
      id: "t1", linearIssueId: "i1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
      linearProjectId: null, repoPath: "/tmp/r", harness: "claude-code", prompt: "p",
      metadata: null, createdAt: 1,
    }).run();
    db.insert(runs).values({ id: "r1", ticketId: "t1", status: "running", createdAt: 1 }).run();

    const before = db.select().from(runs).where(eq(runs.id, "r1")).get();
    expect(before?.cancelRequested).toBe(0);

    db.update(runs).set({ cancelRequested: 1 }).where(eq(runs.id, "r1")).run();
    const after = db.select().from(runs).where(eq(runs.id, "r1")).get();
    expect(after?.cancelRequested).toBe(1);
  });
});
