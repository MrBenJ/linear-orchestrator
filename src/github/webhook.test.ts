import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyGithubSignature, parseMergeEvent } from "./webhook";

const secret = "gh-secret";
function sign(body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

describe("verifyGithubSignature", () => {
  it("accepts a correct sha256= signature", () => {
    const body = JSON.stringify({ action: "closed" });
    expect(verifyGithubSignature(body, sign(body), secret)).toBe(true);
  });
  it("rejects a wrong signature and a missing one", () => {
    expect(verifyGithubSignature("{}", "sha256=deadbeef", secret)).toBe(false);
    expect(verifyGithubSignature("{}", null, secret)).toBe(false);
  });
});

describe("parseMergeEvent", () => {
  it("extracts branch + pr number for a merged PR", () => {
    const ev = parseMergeEvent({
      action: "closed",
      pull_request: { number: 7, merged: true, html_url: "u", head: { ref: "lo/ENG-1-abcd1234" } },
    });
    expect(ev).toEqual({ branch: "lo/ENG-1-abcd1234", prNumber: 7, prUrl: "u" });
  });
  it("returns null for closed-without-merge and non-pull_request payloads", () => {
    expect(parseMergeEvent({ action: "closed", pull_request: { number: 7, merged: false, head: { ref: "x" } } })).toBeNull();
    expect(parseMergeEvent({ action: "opened", pull_request: { number: 7, merged: true, head: { ref: "x" } } })).toBeNull();
    expect(parseMergeEvent({ zen: "hello" })).toBeNull();
  });
});
