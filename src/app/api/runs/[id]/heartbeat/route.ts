import { handleHeartbeat } from "./handler";
import { getDb } from "@/db/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handleHeartbeat(req, id, { db: getDb() });
}
