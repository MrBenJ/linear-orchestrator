import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleGithubWebhook } from "./handler";
import { makeTestDb } from "../../../../../test/helpers/testDb";
import { makeTestConfig } from "../../../../../test/helpers/testConfig";
import { FakeLinearGateway } from "../../../../../test/helpers/fakeLinear";
import {
  createTicketAndRun,
  claimNextQueuedRun,
  setWorktree,
  markTerminal,
  recordPrLinkage,
  getRunWithTicket,
} from "@/runs/service";

const secret = "gh-secret";
const PR_URL = "https://github.com/o/r/pull/12";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "issue-1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: "proj-1", repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  setWorktree(db, runId, "/wt/x", "lo/ENG-1-abcd1234");
  // Agent finished with an OPEN PR awaiting merge (parked in inReview).
  recordPrLinkage(db, runId, PR_URL, "open");
  markTerminal(db, runId, "completed", { exitCode: 0 });
  return { db, runId, config: makeTestConfig(), linear: new FakeLinearGateway() };
}

function req(body: unknown, sign = true): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sign) headers["x-hub-signature-256"] = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return new Request("http://localhost/api/webhooks/github", { method: "POST", headers, body: raw });
}

function mergeEvent(opts: { branch?: string; number?: number; url?: string } = {}) {
  return {
    action: "closed",
    pull_request: {
      number: opts.number ?? 12,
      merged: true,
      html_url: opts.url ?? PR_URL,
      head: { ref: opts.branch ?? "lo/ENG-1-abcd1234" },
    },
  };
}

describe("handleGithubWebhook", () => {
  it("drives the matched ticket to done when the merge matches the run's open PR", async () => {
    const { db, runId, config, linear } = setup();
    const res = await handleGithubWebhook(req(mergeEvent()), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(200);
    expect(linear.stateUpdates).toEqual([{ issueId: "issue-1", stateId: "s-done" }]);
    expect(getRunWithTicket(db, runId)!.run.prState).toBe("merged");
  });

  it("rejects a bad signature with 401", async () => {
    const { db, config, linear } = setup();
    const res = await handleGithubWebhook(req(mergeEvent(), false), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(401);
  });

  it("ignores a branch match whose PR URL differs (wrong repo / wrong number)", async () => {
    const { db, runId, config, linear } = setup();
    const res = await handleGithubWebhook(
      req(mergeEvent({ url: "https://github.com/evil/other/pull/12" })),
      { db, config, linear, webhookSecret: secret },
    );
    expect(res.status).toBe(200);
    expect(linear.stateUpdates).toEqual([]);
    expect(getRunWithTicket(db, runId)!.run.prState).toBe("open");
  });

  it("ignores a merge for a run not in the open-PR state (e.g. already merged)", async () => {
    const { db, config, linear } = setup();
    // first merge drives done + flips prState to merged
    await handleGithubWebhook(req(mergeEvent()), { db, config, linear, webhookSecret: secret });
    linear.stateUpdates.length = 0;
    // a duplicate merge event must not re-drive
    const res = await handleGithubWebhook(req(mergeEvent()), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(200);
    expect(linear.stateUpdates).toEqual([]);
  });

  it("does not mark merged if the Linear transition fails, so a retry still drives done", async () => {
    const { db, runId, config, linear } = setup();
    linear.failStateUpdate = true;

    const res1 = await handleGithubWebhook(req(mergeEvent()), { db, config, linear, webhookSecret: secret });
    expect(res1.status).toBe(503); // signal GitHub to retry
    expect(linear.stateUpdates).toEqual([]);
    expect(getRunWithTicket(db, runId)!.run.prState).toBe("open"); // not flipped — retry can re-enter

    // GitHub redelivers; Linear is back.
    linear.failStateUpdate = false;
    const res2 = await handleGithubWebhook(req(mergeEvent()), { db, config, linear, webhookSecret: secret });
    expect(res2.status).toBe(200);
    expect(linear.stateUpdates).toEqual([{ issueId: "issue-1", stateId: "s-done" }]);
    expect(getRunWithTicket(db, runId)!.run.prState).toBe("merged");
  });

  it("acknowledges unmatched / non-merge events with 200 and does nothing", async () => {
    const { db, config, linear } = setup();
    const ping = { action: "closed", pull_request: { number: 99, merged: false, head: { ref: "other" } } };
    const res = await handleGithubWebhook(req(ping), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(200);
    expect(linear.stateUpdates).toEqual([]);
  });
});
