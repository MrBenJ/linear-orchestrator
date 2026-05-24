import { describe, it, expect } from "vitest";
import { newCallbackToken, buildAgentEnv } from "./agentEnv";

describe("agentEnv", () => {
  it("generates a high-entropy url-safe token", () => {
    const a = newCallbackToken();
    const b = newCallbackToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("forwards runtime + agent creds and the LO_* callback vars", () => {
    const env = buildAgentEnv({
      base: { PATH: "/usr/bin", HOME: "/home/me", GITHUB_TOKEN: "ght", ANTHROPIC_API_KEY: "ak" },
      runId: "r1",
      callbackUrl: "http://localhost:3000/api/runs/r1",
      callbackToken: "tok",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/me");
    expect(env.GITHUB_TOKEN).toBe("ght");
    expect(env.ANTHROPIC_API_KEY).toBe("ak");
    expect(env.LO_RUN_ID).toBe("r1");
    expect(env.LO_CALLBACK_URL).toBe("http://localhost:3000/api/runs/r1");
    expect(env.LO_CALLBACK_TOKEN).toBe("tok");
  });

  it("strips LO operator, Linear, and webhook secrets from the child env", () => {
    const env = buildAgentEnv({
      base: {
        PATH: "/usr/bin",
        LO_API_TOKEN: "op-secret",
        LINEAR_API_KEY: "lin-secret",
        LINEAR_WEBHOOK_SECRET: "lin-wh",
        GITHUB_WEBHOOK_SECRET: "gh-wh",
      },
      runId: "r1",
      callbackUrl: "http://localhost:3000/api/runs/r1",
      callbackToken: "tok",
    });
    expect(env.LO_API_TOKEN).toBeUndefined();
    expect(env.LINEAR_API_KEY).toBeUndefined();
    expect(env.LINEAR_WEBHOOK_SECRET).toBeUndefined();
    expect(env.GITHUB_WEBHOOK_SECRET).toBeUndefined();
    expect(env.PATH).toBe("/usr/bin"); // non-secret runtime vars still pass through
  });
});
