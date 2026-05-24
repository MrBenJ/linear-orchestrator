import { handleGetRun } from "../readHandlers";
import { getDb } from "@/db/client";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handleGetRun(id, { db: getDb() });
}
