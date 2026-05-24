import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { handleCreateTickets } from "./handler";
import { makeTestDb } from "../../../../test/helpers/testDb";
import { makeTestConfig } from "../../../../test/helpers/testConfig";
import { FakeLinearGateway } from "../../../../test/helpers/fakeLinear";
import { tickets, runs } from "@/db/schema";

function post(body: unknown): Request {
  return new Request("http://localhost/api/tickets", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validTicket = {
  linearTeamId: "team-1",
  linearProjectId: "proj-1",
  title: "Add foo",
  description: "desc",
  acceptanceCriteria: ["does foo"],
  prompt: "implement foo",
  harness: "claude-code",
};

describe("handleCreateTickets", () => {
  it("creates the issue, persists ticket+run, and transitions to inProgress", async () => {
    const db = makeTestDb();
    const config = makeTestConfig();
    const linear = new FakeLinearGateway();

    const res = await handleCreateTickets(post({ tickets: [validTicket] }), { db, config, linear });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tickets[0].linearIdentifier).toBe("ENG-1");

    expect(linear.createdIssues).toHaveLength(1);
    expect(linear.stateUpdates).toEqual([{ issueId: "issue-1", stateId: "s-prog" }]);

    const ticketRow = db.select().from(tickets).where(eq(tickets.linearIssueId, "issue-1")).get();
    expect(ticketRow?.repoPath).toBe("/tmp/repo");
    const runRow = db.select().from(runs).where(eq(runs.ticketId, ticketRow!.id)).get();
    expect(runRow?.status).toBe("queued");
  });

  it("rejects an unknown team with 400 and persists nothing", async () => {
    const db = makeTestDb();
    const linear = new FakeLinearGateway();
    const res = await handleCreateTickets(
      post({ tickets: [{ ...validTicket, linearTeamId: "ghost" }] }),
      { db, config: makeTestConfig(), linear },
    );
    expect(res.status).toBe(400);
    expect(linear.createdIssues).toHaveLength(0);
    expect(db.select().from(tickets).all()).toHaveLength(0);
  });

  it("rejects an unknown project with 400", async () => {
    const db = makeTestDb();
    const linear = new FakeLinearGateway();
    const res = await handleCreateTickets(
      post({ tickets: [{ ...validTicket, linearProjectId: "ghost" }] }),
      { db, config: makeTestConfig(), linear },
    );
    expect(res.status).toBe(400);
    expect(linear.createdIssues).toHaveLength(0);
  });

  it("returns 400 on a malformed body", async () => {
    const db = makeTestDb();
    const res = await handleCreateTickets(post({ nope: true }), {
      db,
      config: makeTestConfig(),
      linear: new FakeLinearGateway(),
    });
    expect(res.status).toBe(400);
  });
});
