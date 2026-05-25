import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleGithubWebhook } from "./handler";
import { makeTestDb } from "../../../../../test/helpers/testDb";
import { makeTestConfig } from "../../../../../test/helpers/testConfig";
import { FakeLinearGateway } from "../../../../../test/helpers/fakeLinear";
import { createTicketAndRun, claimNextQueuedRun, setWorktree, markTerminal, getRunWithTicket } from "@/runs/service";

const secret = "gh-secret";

function setup() {
  const db = makeTestDb();
  const { runId } = createTicketAndRun(db, {
    linearIssueId: "issue-1", linearIdentifier: "ENG-1", linearTeamId: "team-1",
    linearProjectId: "proj-1", repoPath: "/tmp/r", harness: "claude-code", prompt: "p", metadata: null,
  });
  claimNextQueuedRun(db);
  setWorktree(db, runId, "/wt/x", "lo/ENG-1-abcd1234");
  markTerminal(db, runId, "completed", { exitCode: 0 });
  return { db, runId, config: makeTestConfig(), linear: new FakeLinearGateway() };
}

function req(body: unknown, sign = true): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sign) headers["x-hub-signature-256"] = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return new Request("http://localhost/api/webhooks/github", { method: "POST", headers, body: raw });
}

const merged = {
  action: "closed",
  pull_request: { number: 12, merged: true, html_url: "https://github.com/o/r/pull/12", head: { ref: "lo/ENG-1-abcd1234" } },
};

describe("handleGithubWebhook", () => {
  it("drives the matched ticket to done on a merged PR", async () => {
    const { db, runId, config, linear } = setup();
    const res = await handleGithubWebhook(req(merged), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(200);
    expect(linear.stateUpdates).toEqual([{ issueId: "issue-1", stateId: "s-done" }]);
    expect(getRunWithTicket(db, runId)!.run.prState).toBe("merged");
  });

  it("rejects a bad signature with 401", async () => {
    const { db, config, linear } = setup();
    const res = await handleGithubWebhook(req(merged, false), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(401);
  });

  it("acknowledges unmatched / non-merge events with 200 and does nothing", async () => {
    const { db, config, linear } = setup();
    const ping = { action: "closed", pull_request: { number: 99, merged: false, head: { ref: "other" } } };
    const res = await handleGithubWebhook(req(ping), { db, config, linear, webhookSecret: secret });
    expect(res.status).toBe(200);
    expect(linear.stateUpdates).toEqual([]);
  });
});
