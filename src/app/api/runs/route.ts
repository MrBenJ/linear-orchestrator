import { handleListRuns } from "./readHandlers";
import { getDb } from "@/db/client";

export async function GET(req: Request): Promise<Response> {
  const apiToken = process.env.LO_API_TOKEN;
  if (!apiToken) return new Response("LO_API_TOKEN not set", { status: 500 });
  return handleListRuns(req, { db: getDb(), apiToken });
}
