import { handleGithubWebhook } from "./handler";
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getLinearGateway } from "@/linear/client";

export async function POST(req: Request): Promise<Response> {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) return new Response("GITHUB_WEBHOOK_SECRET not set", { status: 500 });
  return handleGithubWebhook(req, {
    db: getDb(),
    config: getConfig(),
    linear: getLinearGateway(),
    webhookSecret,
  });
}
