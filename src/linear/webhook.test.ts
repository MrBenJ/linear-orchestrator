import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLinearSignature } from "./webhook";

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
