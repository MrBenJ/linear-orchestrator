import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLinearSignature, isWebhookFresh } from "./webhook";

const secret = "shh";
const body = JSON.stringify({ action: "update", type: "Issue" });
const sig = createHmac("sha256", secret).update(body).digest("hex");

describe("verifyLinearSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyLinearSignature(body, sig, secret)).toBe(true);
  });
  it("rejects a wrong signature", () => {
    expect(verifyLinearSignature(body, "deadbeef", secret)).toBe(false);
  });
  it("rejects a missing signature", () => {
    expect(verifyLinearSignature(body, null, secret)).toBe(false);
  });
});

describe("isWebhookFresh", () => {
  const now = 1_000_000_000_000;

  it("accepts a timestamp within the freshness window", () => {
    expect(isWebhookFresh(now - 30_000, now)).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    expect(isWebhookFresh(now - 120_000, now)).toBe(false);
  });

  it("rejects a missing or non-numeric timestamp", () => {
    expect(isWebhookFresh(undefined, now)).toBe(false);
    expect(isWebhookFresh(Number.NaN, now)).toBe(false);
  });
});
