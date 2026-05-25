import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface MergeEvent {
  branch: string;
  prNumber: number;
  prUrl: string;
}

interface GithubPrPayload {
  action?: string;
  pull_request?: {
    number?: number;
    merged?: boolean;
    html_url?: string;
    head?: { ref?: string };
  };
}

/** Returns merge details for a `pull_request closed+merged` event, else null. */
export function parseMergeEvent(payload: unknown): MergeEvent | null {
  const p = payload as GithubPrPayload;
  if (p.action !== "closed") return null;
  const pr = p.pull_request;
  if (!pr || pr.merged !== true) return null;
  const branch = pr.head?.ref;
  if (!branch || typeof pr.number !== "number") return null;
  return { branch, prNumber: pr.number, prUrl: pr.html_url ?? "" };
}
