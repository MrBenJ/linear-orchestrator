import { handleCancel } from "./handler";
import { getDb } from "@/db/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const apiToken = process.env.LO_API_TOKEN;
  if (!apiToken) return new Response("LO_API_TOKEN not set", { status: 500 });
  const { id } = await params;
  return handleCancel(req, id, { db: getDb(), apiToken });
}
