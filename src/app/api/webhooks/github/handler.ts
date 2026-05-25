import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { resolveStateMap } from "@/config";
import type { LinearGateway } from "@/linear/gateway";
import { applyRunOutcome } from "@/linear/ticketActions";
import { findRunByBranch, markPrMerged } from "@/runs/service";
import { verifyGithubSignature, parseMergeEvent } from "@/github/webhook";

export interface GithubWebhookDeps {
  db: DB;
  config: Config;
  linear: LinearGateway;
  webhookSecret: string;
}

export async function handleGithubWebhook(req: Request, deps: GithubWebhookDeps): Promise<Response> {
  const rawBody = await req.text();
  if (!verifyGithubSignature(rawBody, req.headers.get("x-hub-signature-256"), deps.webhookSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("ok", { status: 200 });
  }

  const merge = parseMergeEvent(payload);
  if (!merge) return new Response("ok", { status: 200 });

  const found = findRunByBranch(deps.db, merge.branch);
  if (!found) return new Response("ok", { status: 200 }); // not an LO-managed PR

  // Authorization boundary: the head-branch name alone is not a secret and can
  // collide across repos (an org-level webhook / reused secret would otherwise
  // let any matching-branch merge complete this ticket). Require the event to
  // match the PR the agent actually reported for this run — an exact prUrl match
  // pins both the repository and the PR number — and that the run is still
  // awaiting merge (`open`), which also blocks duplicate/replayed merge events.
  if (found.run.prState !== "open" || found.run.prUrl !== merge.prUrl) {
    return new Response("ok", { status: 200 });
  }

  // Drive Linear FIRST, then persist prState=merged only on success. If the
  // Linear update fails, we leave prState="open" and return 503 so GitHub
  // redelivers — the guard above still passes on retry, so the ticket reaches
  // `done` once Linear recovers. (Flipping to merged first would lock the retry
  // out of the guard and strand the ticket in review.)
  const stateMap = resolveStateMap(deps.config, found.ticket.linearTeamId);
  if (stateMap) {
    try {
      await applyRunOutcome(deps.linear, {
        issueId: found.ticket.linearIssueId,
        teamId: found.ticket.linearTeamId,
        stateMap,
        needsHumanLabel: deps.config.orchestrationLabels.needsHuman,
        outcome: { status: "success", prMerged: true, prUrl: merge.prUrl },
      });
    } catch (e) {
      console.error(`[github-webhook] Linear transition failed for run ${found.run.id}:`, e);
      return new Response("linear update failed; please retry", { status: 503 });
    }
  }

  markPrMerged(deps.db, found.run.id, merge.prUrl);
  return new Response("ok", { status: 200 });
}
