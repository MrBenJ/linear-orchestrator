import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLinearSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Linear includes a `webhookTimestamp` (ms epoch) and recommends rejecting
 * payloads outside a small freshness window to blunt replay attacks. A valid
 * HMAC stays valid forever, so signature verification alone is not enough.
 */
export function isWebhookFresh(
  timestamp: number | undefined,
  nowMs: number,
  maxAgeMs = 60_000,
): boolean {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return false;
  return Math.abs(nowMs - timestamp) <= maxAgeMs;
}
