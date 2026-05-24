import { randomBytes } from "node:crypto";

export function newCallbackToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * LO-internal secrets that must never reach a spawned agent. The agent runs an
 * untrusted, user-authored prompt with permission bypass, so handing it LO's
 * operator token, Linear API key, or webhook secrets would let a prompt-injected
 * run exfiltrate them or call operator endpoints. The agent still receives the
 * credentials it genuinely needs for its job (GITHUB_TOKEN, ANTHROPIC_API_KEY)
 * and the rest of the runtime environment so project tooling works.
 */
const LO_SECRET_DENYLIST = new Set([
  "LO_API_TOKEN",
  "LINEAR_API_KEY",
  "LINEAR_WEBHOOK_SECRET",
  "GITHUB_WEBHOOK_SECRET",
]);

export interface AgentEnvInput {
  base: NodeJS.ProcessEnv;
  runId: string;
  callbackUrl: string;
  callbackToken: string;
}

export function buildAgentEnv(input: AgentEnvInput): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(input.base)) {
    if (!LO_SECRET_DENYLIST.has(key)) out[key] = value;
  }
  out.LO_RUN_ID = input.runId;
  out.LO_CALLBACK_URL = input.callbackUrl;
  out.LO_CALLBACK_TOKEN = input.callbackToken;
  return out;
}
