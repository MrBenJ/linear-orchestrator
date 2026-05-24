import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "../../test/helpers/testDb";
import { createTicketAndRun, getRun } from "./service";
import { tickets, runs } from "@/db/schema";

const input = {
  linearIssueId: "issue-1",
  linearIdentifier: "ENG-1",
  linearTeamId: "team-1",
  linearProjectId: "proj-1" as string | null,
  repoPath: "/tmp/repo",
  harness: "claude-code",
  prompt: "do it",
  metadata: { title: "t" },
};

describe("createTicketAndRun", () => {
  it("inserts a ticket and a queued run in one transaction", () => {
    const db = makeTestDb();
    const { ticketId, runId } = createTicketAndRun(db, input);

    const ticket = db.select().from(tickets).where(eq(tickets.id, ticketId)).get();
    expect(ticket?.linearIssueId).toBe("issue-1");
    expect(ticket?.metadata).toBe(JSON.stringify({ title: "t" }));

    const run = getRun(db, runId);
    expect(run?.status).toBe("queued");
    expect(run?.ticketId).toBe(ticketId);
  });

  it("rolls back the ticket if the run insert fails (duplicate issue id)", () => {
    const db = makeTestDb();
    createTicketAndRun(db, input);
    // second insert with the same linearIssueId violates the unique constraint
    expect(() => createTicketAndRun(db, input)).toThrow();
    const all = db.select().from(runs).all();
    expect(all).toHaveLength(1);
  });
});
