import { handleGetLogs } from "../../readHandlers";
import { getDb } from "@/db/client";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const from = Number(new URL(req.url).searchParams.get("from") ?? "0");
  return handleGetLogs(id, Number.isFinite(from) ? from : 0, { db: getDb() });
}
