import { handleCreateTickets } from "./handler";
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getLinearGateway } from "@/linear/client";

export async function POST(req: Request): Promise<Response> {
  return handleCreateTickets(req, {
    db: getDb(),
    config: getConfig(),
    linear: getLinearGateway(),
  });
}
