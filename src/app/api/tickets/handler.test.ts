import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { handleCreateTickets, type TicketsDeps } from "./handler";
import { makeTestDb } from "../../../../test/helpers/testDb";
import { makeTestConfig } from "../../../../test/helpers/testConfig";
import { FakeLinearGateway } from "../../../../test/helpers/fakeLinear";
import { tickets, runs } from "@/db/schema";

const TOKEN = "test-token";

function deps(over: Partial<TicketsDeps> = {}): TicketsDeps {
  return {
    db: makeTestDb(),
    config: makeTestConfig(),
    linear: new FakeLinearGateway(),
    apiToken: TOKEN,
    ...over,
  };
}

function post(body: unknown, auth: string | null = `Bearer ${TOKEN}`): Request {
  const headers: Record<string, string> = {};
  if (auth !== null) headers["authorization"] = auth;
  return new Request("http://localhost/api/tickets", {
    method: "POST",
    headers,
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
    const d = deps();
    const res = await handleCreateTickets(post({ tickets: [validTicket] }), d);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tickets[0].linearIdentifier).toBe("ENG-1");
    expect(json.tickets[0].stateTransitioned).toBe(true);
    expect(json.errors).toEqual([]);

    const linear = d.linear as FakeLinearGateway;
    expect(linear.createdIssues).toHaveLength(1);
    expect(linear.stateUpdates).toEqual([{ issueId: "issue-1", stateId: "s-prog" }]);

    const ticketRow = d.db.select().from(tickets).where(eq(tickets.linearIssueId, "issue-1")).get();
    expect(ticketRow?.repoPath).toBe("/tmp/repo");
    const runRow = d.db.select().from(runs).where(eq(runs.ticketId, ticketRow!.id)).get();
    expect(runRow?.status).toBe("queued");
  });

  it("rejects a missing Authorization header with 401 and persists nothing", async () => {
    const d = deps();
    const res = await handleCreateTickets(post({ tickets: [validTicket] }, null), d);
    expect(res.status).toBe(401);
    expect((d.linear as FakeLinearGateway).createdIssues).toHaveLength(0);
    expect(d.db.select().from(tickets).all()).toHaveLength(0);
  });

  it("rejects a wrong bearer token with 401", async () => {
    const d = deps();
    const res = await handleCreateTickets(post({ tickets: [validTicket] }, "Bearer nope"), d);
    expect(res.status).toBe(401);
    expect((d.linear as FakeLinearGateway).createdIssues).toHaveLength(0);
  });

  it("rejects an unknown team with 400 and persists nothing", async () => {
    const d = deps();
    const res = await handleCreateTickets(
      post({ tickets: [{ ...validTicket, linearTeamId: "ghost" }] }),
      d,
    );
    expect(res.status).toBe(400);
    expect((d.linear as FakeLinearGateway).createdIssues).toHaveLength(0);
    expect(d.db.select().from(tickets).all()).toHaveLength(0);
  });

  it("rejects an unknown project with 400", async () => {
    const d = deps();
    const res = await handleCreateTickets(
      post({ tickets: [{ ...validTicket, linearProjectId: "ghost" }] }),
      d,
    );
    expect(res.status).toBe(400);
    expect((d.linear as FakeLinearGateway).createdIssues).toHaveLength(0);
  });

  it("returns 400 on a malformed body", async () => {
    const res = await handleCreateTickets(post({ nope: true }), deps());
    expect(res.status).toBe(400);
  });

  it("persists the run even when the state transition fails (no client retry trap)", async () => {
    const linear = new FakeLinearGateway();
    linear.failStateUpdate = true;
    const d = deps({ linear });
    const res = await handleCreateTickets(post({ tickets: [validTicket] }), d);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tickets[0].stateTransitioned).toBe(false);
    expect(json.tickets[0].warning).toMatch(/state transition failed/i);

    // The durable state (ticket + queued run) is persisted despite the failure.
    const ticketRow = d.db.select().from(tickets).where(eq(tickets.linearIssueId, "issue-1")).get();
    expect(ticketRow).toBeTruthy();
    const runRow = d.db.select().from(runs).where(eq(runs.ticketId, ticketRow!.id)).get();
    expect(runRow?.status).toBe("queued");
  });

  it("reports per-ticket partial failure in a multi-ticket batch", async () => {
    const linear = new FakeLinearGateway();
    linear.failCreateOnCall = 2; // first ticket succeeds, second fails at createIssue
    const d = deps({ linear });
    const res = await handleCreateTickets(
      post({ tickets: [validTicket, { ...validTicket, title: "Second" }] }),
      d,
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.tickets).toHaveLength(1);
    expect(json.errors).toHaveLength(1);
    expect(json.errors[0].title).toBe("Second");
    // Exactly one ticket persisted (the successful one).
    expect(d.db.select().from(tickets).all()).toHaveLength(1);
  });
});
