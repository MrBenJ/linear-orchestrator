import { handleCreateTickets } from "./handler";
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getLinearGateway } from "@/linear/client";

export async function POST(req: Request): Promise<Response> {
  const apiToken = process.env.LO_API_TOKEN;
  if (!apiToken) return new Response("LO_API_TOKEN not set", { status: 500 });
  return handleCreateTickets(req, {
    db: getDb(),
    config: getConfig(),
    linear: getLinearGateway(),
    apiToken,
  });
}
