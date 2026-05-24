import { timingSafeEqual } from "node:crypto";
import type { DB } from "@/db/client";
import { getRunWithTicket, listRuns } from "@/runs/service";
import { readLogs } from "@/runs/logs";

export interface ReadDeps {
  db: DB;
  apiToken: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function authorized(req: Request, apiToken: string): boolean {
  const header = req.headers.get("authorization");
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${apiToken}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleListRuns(req: Request, deps: ReadDeps): Promise<Response> {
  if (!authorized(req, deps.apiToken)) return json({ error: "unauthorized" }, 401);
  const runs = listRuns(deps.db).map((r) => ({
    id: r.id,
    status: r.status,
    branchName: r.branchName,
    startedAt: r.startedAt,
    createdAt: r.createdAt,
  }));
  return json({ runs });
}

export async function handleGetRun(req: Request, runId: string, deps: ReadDeps): Promise<Response> {
  if (!authorized(req, deps.apiToken)) return json({ error: "unauthorized" }, 401);
  const joined = getRunWithTicket(deps.db, runId);
  if (!joined) return json({ error: "not found" }, 404);
  // Never expose the per-run callback token — it would let a reader impersonate
  // the agent on /complete and /heartbeat.
  const { callbackToken: _redacted, ...run } = joined.run;
  return json({ run, ticket: { identifier: joined.ticket.linearIdentifier } });
}

export async function handleGetLogs(
  req: Request,
  runId: string,
  fromSeq: number,
  deps: ReadDeps,
): Promise<Response> {
  if (!authorized(req, deps.apiToken)) return json({ error: "unauthorized" }, 401);
  if (!getRunWithTicket(deps.db, runId)) return json({ error: "not found" }, 404);
  return json({ logs: readLogs(deps.db, runId, fromSeq) });
}
