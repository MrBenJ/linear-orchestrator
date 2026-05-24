import { handleLinearWebhook } from "./handler";
import { getDb } from "@/db/client";

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!webhookSecret) return new Response("LINEAR_WEBHOOK_SECRET not set", { status: 500 });
  return handleLinearWebhook(req, { db: getDb(), webhookSecret });
}
