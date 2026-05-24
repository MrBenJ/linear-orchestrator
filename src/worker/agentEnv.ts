import { randomBytes } from "node:crypto";

export function newCallbackToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Deny-by-default env for spawned agents. The agent runs an untrusted,
 * user-authored prompt with permission bypass, so it must NOT inherit the
 * worker's secrets (LO operator token, Linear keys, webhook secrets, but also
 * any unrelated OPENAI_API_KEY / AWS_* / NPM_TOKEN / DATABASE_URL present in the
 * LO process environment). We forward only an explicit allowlist: baseline
 * runtime vars needed to start tooling, the credentials the agent legitimately
 * needs for its job, and the per-run callback vars.
 *
 * If a project's tooling needs additional vars, extend RUNTIME_ALLOWLIST (a
 * future config knob) rather than widening the default.
 */
const RUNTIME_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "LOGNAME",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "TMPDIR",
  "TZ",
  "PWD",
  "NODE_ENV",
  "NODE_OPTIONS",
  "NVM_DIR",
  "NVM_BIN",
  "NVM_INC",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "SSH_AUTH_SOCK",
]);

/** Credentials the agent deliberately receives to push, open PRs, and run claude-code. */
const AGENT_CREDENTIAL_ALLOWLIST = new Set(["GITHUB_TOKEN", "ANTHROPIC_API_KEY"]);

export interface AgentEnvInput {
  base: Record<string, string | undefined>;
  runId: string;
  callbackUrl: string;
  callbackToken: string;
}

export function buildAgentEnv(input: AgentEnvInput): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(input.base)) {
    if (RUNTIME_ALLOWLIST.has(key) || AGENT_CREDENTIAL_ALLOWLIST.has(key)) out[key] = value;
  }
  out.LO_RUN_ID = input.runId;
  out.LO_CALLBACK_URL = input.callbackUrl;
  out.LO_CALLBACK_TOKEN = input.callbackToken;
  return out;
}
