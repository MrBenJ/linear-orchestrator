import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleLinearWebhook } from "./handler";
import { makeTestDb } from "../../../../../test/helpers/testDb";

const secret = "shh";

function signedRequest(payload: unknown): Request {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("http://localhost/api/webhooks/linear", {
    method: "POST",
    headers: { "linear-signature": sig },
    body,
  });
}

describe("handleLinearWebhook", () => {
  it("returns 200 for a correctly-signed event", async () => {
    const res = await handleLinearWebhook(signedRequest({ action: "update", type: "Issue" }), {
      db: makeTestDb(),
      webhookSecret: secret,
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 for a bad signature", async () => {
    const req = new Request("http://localhost/api/webhooks/linear", {
      method: "POST",
      headers: { "linear-signature": "wrong" },
      body: JSON.stringify({ action: "update", type: "Issue" }),
    });
    const res = await handleLinearWebhook(req, { db: makeTestDb(), webhookSecret: secret });
    expect(res.status).toBe(401);
  });
});
