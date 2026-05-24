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

  it("sets LO_* vars and forwards selected secrets", () => {
    const env = buildAgentEnv({
      base: { PATH: "/usr/bin", GITHUB_TOKEN: "ght", ANTHROPIC_API_KEY: "ak", SECRET_X: "nope" },
      runId: "r1",
      callbackUrl: "http://localhost:3000/api/runs/r1",
      callbackToken: "tok",
    });
    expect(env.LO_RUN_ID).toBe("r1");
    expect(env.LO_CALLBACK_URL).toBe("http://localhost:3000/api/runs/r1");
    expect(env.LO_CALLBACK_TOKEN).toBe("tok");
    expect(env.GITHUB_TOKEN).toBe("ght");
    expect(env.ANTHROPIC_API_KEY).toBe("ak");
    expect(env.PATH).toBe("/usr/bin");
  });
});
