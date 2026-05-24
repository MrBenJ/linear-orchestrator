import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../test/helpers/testDb";
import { tickets } from "./schema";

describe("createDb", () => {
  it("creates tables and round-trips a ticket", () => {
    const db = makeTestDb();
    db.insert(tickets)
      .values({
        id: "t1",
        linearIssueId: "issue-1",
        linearIdentifier: "ENG-1",
        linearTeamId: "team-1",
        linearProjectId: "proj-1",
        repoPath: "/tmp/repo",
        harness: "claude-code",
        prompt: "do the thing",
        metadata: null,
        createdAt: 123,
      })
      .run();

    const row = db.select().from(tickets).where(eq(tickets.id, "t1")).get();
    expect(row?.linearIdentifier).toBe("ENG-1");
  });
});
