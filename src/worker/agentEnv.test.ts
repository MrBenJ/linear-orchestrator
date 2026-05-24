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

  it("forwards allowlisted runtime vars, accepted agent creds, and the LO_* callback vars", () => {
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

  it("denies unknown/secret-like vars by default (allowlist, not denylist)", () => {
    const env = buildAgentEnv({
      base: {
        PATH: "/usr/bin",
        LO_API_TOKEN: "op-secret",
        LINEAR_API_KEY: "lin-secret",
        OPENAI_API_KEY: "oai",
        AWS_SECRET_ACCESS_KEY: "aws",
        NPM_TOKEN: "npm",
        DATABASE_URL: "postgres://secret",
        SOME_OTHER_TOKEN: "x",
      },
      runId: "r1",
      callbackUrl: "http://localhost:3000/api/runs/r1",
      callbackToken: "tok",
    });
    expect(env.PATH).toBe("/usr/bin"); // allowlisted runtime var passes
    for (const k of [
      "LO_API_TOKEN",
      "LINEAR_API_KEY",
      "OPENAI_API_KEY",
      "AWS_SECRET_ACCESS_KEY",
      "NPM_TOKEN",
      "DATABASE_URL",
      "SOME_OTHER_TOKEN",
    ]) {
      expect(env[k]).toBeUndefined();
    }
  });
});
