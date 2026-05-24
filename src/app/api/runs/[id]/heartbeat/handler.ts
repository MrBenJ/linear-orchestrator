import { timingSafeEqual } from "node:crypto";
import type { DB } from "@/db/client";
import { getRunWithTicket, touchHeartbeat } from "@/runs/service";

export interface HeartbeatDeps {
  db: DB;
}

function bearerEquals(header: string | null, token: string | null): boolean {
  if (!header || !token) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleHeartbeat(req: Request, runId: string, deps: HeartbeatDeps): Promise<Response> {
  const joined = getRunWithTicket(deps.db, runId);
  if (!joined) return new Response("run not found", { status: 404 });
  if (!bearerEquals(req.headers.get("authorization"), joined.run.callbackToken)) {
    return new Response("unauthorized", { status: 401 });
  }
  touchHeartbeat(deps.db, runId);
  return new Response(null, { status: 204 });
}
