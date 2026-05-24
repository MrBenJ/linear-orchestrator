import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { tickets } from "@/db/schema";
import { verifyLinearSignature, isWebhookFresh } from "@/linear/webhook";

export interface LinearWebhookDeps {
  db: DB;
  webhookSecret: string;
}

export async function handleLinearWebhook(req: Request, deps: LinearWebhookDeps): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("linear-signature");
  if (!verifyLinearSignature(rawBody, signature, deps.webhookSecret)) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: { type?: string; data?: { id?: string }; webhookTimestamp?: number };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("ok", { status: 200 }); // acknowledge unparseable payloads
  }

  // Reject replays: a valid HMAC never expires, so require a fresh timestamp.
  if (!isWebhookFresh(event.webhookTimestamp, Date.now())) {
    return new Response("stale or missing webhook timestamp", { status: 400 });
  }

  // Phase 1a: for tracked issues we only log the transition for audit. No action.
  if (event.type === "Issue" && event.data?.id) {
    const tracked = deps.db
      .select()
      .from(tickets)
      .where(eq(tickets.linearIssueId, event.data.id))
      .get();
    if (tracked) {
      console.log(`[linear-webhook] state change on tracked issue ${tracked.linearIdentifier}`);
    }
  }

  return new Response("ok", { status: 200 });
}
