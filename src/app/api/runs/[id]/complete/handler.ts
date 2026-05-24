import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { resolveStateMap } from "@/config";
import type { LinearGateway } from "@/linear/gateway";
import { applyRunOutcome } from "@/linear/ticketActions";
import { getRunWithTicket, markTerminal, recordPrLinkage } from "@/runs/service";

const bodySchema = z.object({
  status: z.enum(["success", "failure"]),
  prUrl: z.string().optional(),
  prMerged: z.boolean().optional(),
  summary: z.string().optional(),
  notes: z.string().optional(),
});

export interface CompleteDeps {
  db: DB;
  config: Config;
  linear: LinearGateway;
}

function bearerEquals(header: string | null, token: string | null): boolean {
  if (!header || !token) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleComplete(req: Request, runId: string, deps: CompleteDeps): Promise<Response> {
  const joined = getRunWithTicket(deps.db, runId);
  if (!joined) return new Response("run not found", { status: 404 });
  if (!bearerEquals(req.headers.get("authorization"), joined.run.callbackToken)) {
    return new Response("unauthorized", { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return new Response(JSON.stringify(parsed.error.flatten()), { status: 400 });
  const body = parsed.data;

  // Persist run result + PR linkage first (durable), then drive Linear.
  if (body.prUrl) recordPrLinkage(deps.db, runId, body.prUrl, body.prMerged ? "merged" : "open");
  markTerminal(deps.db, runId, body.status === "success" ? "completed" : "failed", { result: body });

  const stateMap = resolveStateMap(deps.config, joined.ticket.linearTeamId);
  if (stateMap) {
    await applyRunOutcome(deps.linear, {
      issueId: joined.ticket.linearIssueId,
      teamId: joined.ticket.linearTeamId,
      stateMap,
      needsHumanLabel: deps.config.orchestrationLabels.needsHuman,
      outcome: body,
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
