import type { DB } from "@/db/client";
import { getRunWithTicket, listRuns } from "@/runs/service";
import { readLogs } from "@/runs/logs";

export interface ReadDeps {
  db: DB;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

export async function handleListRuns(deps: ReadDeps): Promise<Response> {
  const runs = listRuns(deps.db).map((r) => ({
    id: r.id,
    status: r.status,
    branchName: r.branchName,
    startedAt: r.startedAt,
    createdAt: r.createdAt,
  }));
  return json({ runs });
}

export async function handleGetRun(runId: string, deps: ReadDeps): Promise<Response> {
  const joined = getRunWithTicket(deps.db, runId);
  if (!joined) return json({ error: "not found" }, 404);
  return json({ run: joined.run, ticket: { identifier: joined.ticket.linearIdentifier } });
}

export async function handleGetLogs(runId: string, fromSeq: number, deps: ReadDeps): Promise<Response> {
  if (!getRunWithTicket(deps.db, runId)) return json({ error: "not found" }, 404);
  return json({ logs: readLogs(deps.db, runId, fromSeq) });
}
