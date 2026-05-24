import { timingSafeEqual } from "node:crypto";
import type { DB } from "@/db/client";
import { getRunWithTicket, requestCancel } from "@/runs/service";

export interface CancelDeps {
  db: DB;
  apiToken: string;
}

function bearerEquals(header: string | null, token: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleCancel(req: Request, runId: string, deps: CancelDeps): Promise<Response> {
  if (!bearerEquals(req.headers.get("authorization"), deps.apiToken)) {
    return new Response("unauthorized", { status: 401 });
  }
  if (!getRunWithTicket(deps.db, runId)) return new Response("run not found", { status: 404 });
  requestCancel(deps.db, runId);
  return new Response(null, { status: 202 });
}
