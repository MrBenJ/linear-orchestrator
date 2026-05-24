import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleLinearWebhook } from "./handler";
import { makeTestDb } from "../../../../../test/helpers/testDb";

const secret = "shh";

function signedRequest(payload: Record<string, unknown>): Request {
  const body = JSON.stringify({ webhookTimestamp: Date.now(), ...payload });
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  return new Request("http://localhost/api/webhooks/linear", {
    method: "POST",
    headers: { "linear-signature": sig },
    body,
  });
}

describe("handleLinearWebhook", () => {
  it("returns 200 for a correctly-signed, fresh event", async () => {
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
      body: JSON.stringify({ action: "update", type: "Issue", webhookTimestamp: Date.now() }),
    });
    const res = await handleLinearWebhook(req, { db: makeTestDb(), webhookSecret: secret });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a stale timestamp (replay)", async () => {
    const body = JSON.stringify({ action: "update", type: "Issue", webhookTimestamp: Date.now() - 600_000 });
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const req = new Request("http://localhost/api/webhooks/linear", {
      method: "POST",
      headers: { "linear-signature": sig },
      body,
    });
    const res = await handleLinearWebhook(req, { db: makeTestDb(), webhookSecret: secret });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a missing timestamp", async () => {
    const body = JSON.stringify({ action: "update", type: "Issue" });
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const req = new Request("http://localhost/api/webhooks/linear", {
      method: "POST",
      headers: { "linear-signature": sig },
      body,
    });
    const res = await handleLinearWebhook(req, { db: makeTestDb(), webhookSecret: secret });
    expect(res.status).toBe(400);
  });
});
