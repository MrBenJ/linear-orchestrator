import { randomBytes } from "node:crypto";

export function newCallbackToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface AgentEnvInput {
  base: NodeJS.ProcessEnv;
  runId: string;
  callbackUrl: string;
  callbackToken: string;
}

export function buildAgentEnv(input: AgentEnvInput): NodeJS.ProcessEnv {
  return {
    ...input.base,
    LO_RUN_ID: input.runId,
    LO_CALLBACK_URL: input.callbackUrl,
    LO_CALLBACK_TOKEN: input.callbackToken,
  };
}
