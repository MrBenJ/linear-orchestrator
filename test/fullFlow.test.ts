import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { makeTestDb } from "./helpers/testDb";
import { makeTestConfig } from "./helpers/testConfig";
import { FakeLinearGateway } from "./helpers/fakeLinear";
import { FakePtySpawner } from "./helpers/fakePty";
import { handleCreateTickets } from "@/app/api/tickets/handler";
import { handleComplete } from "@/app/api/runs/[id]/complete/handler";
import { handleGithubWebhook } from "@/app/api/webhooks/github/handler";
import { tick } from "@/worker/loop";
import { spawnAgent } from "@/worker/spawnAgent";
import { getRunWithTicket } from "@/runs/service";

const API_TOKEN = "op-token";
const GH_SECRET = "gh-secret";

describe("full flow: intake -> worker -> complete -> merge -> done", () => {
  it("drives the ticket inProgress -> inReview -> done", async () => {
    const db = makeTestDb();
    const config = makeTestConfig();
    const linear = new FakeLinearGateway();
    const pty = new FakePtySpawner();

    // 1. Intake creates the issue + queued run and transitions to inProgress.
    const ticketReq = new Request("http://localhost/api/tickets", {
      method: "POST",
      headers: { authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify({
        tickets: [{ linearTeamId: "team-1", linearProjectId: "proj-1", title: "T", prompt: "do", harness: "claude-code" }],
      }),
    });
    const ticketRes = await handleCreateTickets(ticketReq, { db, config, linear, apiToken: API_TOKEN });
    const { tickets } = (await ticketRes.json()) as { tickets: Array<{ runId: string }> };
    const runId = tickets[0].runId;

    // 2. Worker claims + spawns the agent (fake pty, fake worktree).
    tick(db, config, {
      reap: () => {},
      spawn: (run) => {
        const joined = getRunWithTicket(db, run.id)!;
        spawnAgent(db, run, joined.ticket, config, {
          pty,
          createWorktree: () => ({ worktreePath: "/wt/x", branchName: "lo/ENG-1-abcd1234" }),
          fetchOrigin: () => {},
          callbackBaseUrl: "http://localhost:3000/api/runs",
          baseEnv: {},
        });
      },
    });

    // 3. Agent completes with an open (un-merged) PR -> ticket parks in inReview.
    const token = getRunWithTicket(db, runId)!.run.callbackToken!;
    const completeReq = new Request(`http://localhost/api/runs/${runId}/complete`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ status: "success", prUrl: "https://github.com/o/r/pull/12", prMerged: false }),
    });
    expect((await handleComplete(completeReq, runId, { db, config, linear })).status).toBe(200);
    pty.lastHandle!.emitExit(0); // agent process exits; status already completed

    // 4. GitHub merge webhook -> ticket -> done.
    const ghBody = JSON.stringify({
      action: "closed",
      pull_request: { number: 12, merged: true, html_url: "https://github.com/o/r/pull/12", head: { ref: "lo/ENG-1-abcd1234" } },
    });
    const ghReq = new Request("http://localhost/api/webhooks/github", {
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=" + createHmac("sha256", GH_SECRET).update(ghBody).digest("hex") },
      body: ghBody,
    });
    expect((await handleGithubWebhook(ghReq, { db, config, linear, webhookSecret: GH_SECRET })).status).toBe(200);

    // Assert the full Linear state progression on the issue.
    expect(linear.stateUpdates).toEqual([
      { issueId: "issue-1", stateId: "s-prog" },
      { issueId: "issue-1", stateId: "s-rev" },
      { issueId: "issue-1", stateId: "s-done" },
    ]);
    expect(getRunWithTicket(db, runId)!.run.prState).toBe("merged");
  });
});
