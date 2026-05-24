import { handleComplete } from "./handler";
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getLinearGateway } from "@/linear/client";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handleComplete(req, id, { db: getDb(), config: getConfig(), linear: getLinearGateway() });
}
