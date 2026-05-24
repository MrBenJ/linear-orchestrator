import { handleGetLogs } from "../../readHandlers";
import { getDb } from "@/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const apiToken = process.env.LO_API_TOKEN;
  if (!apiToken) return new Response("LO_API_TOKEN not set", { status: 500 });
  const { id } = await params;
  const from = Number(new URL(req.url).searchParams.get("from") ?? "0");
  return handleGetLogs(req, id, Number.isFinite(from) ? from : 0, { db: getDb(), apiToken });
}
