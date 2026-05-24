import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { runs } from "@/db/schema";
import type { RunRow, TicketRow } from "@/runs/service";
import { setWorktree, markRunning, markTerminal, getRunWithTicket } from "@/runs/service";
import { appendLog } from "@/runs/logs";
import type { PtySpawner } from "./pty";
import type { CreatedWorktree } from "@/worktree/manager";
import { composeAgentPrompt } from "./promptTemplate";
import { newCallbackToken, buildAgentEnv } from "./agentEnv";

export interface SpawnDeps {
  pty: PtySpawner;
  createWorktree: (args: {
    repoPath: string;
    worktreeRoot: string;
    runId: string;
    identifier: string;
    baseRef: string;
  }) => CreatedWorktree;
  fetchOrigin: (repoPath: string) => void;
  worktreeRoot?: string;
  callbackBaseUrl: string;
  baseEnv: NodeJS.ProcessEnv;
}

export function spawnAgent(
  db: DB,
  run: RunRow,
  ticket: TicketRow,
  _config: Config,
  deps: SpawnDeps,
): void {
  deps.fetchOrigin(ticket.repoPath);
  const { worktreePath, branchName } = deps.createWorktree({
    repoPath: ticket.repoPath,
    worktreeRoot: deps.worktreeRoot ?? "/tmp/lo-worktrees",
    runId: run.id,
    identifier: ticket.linearIdentifier,
    baseRef: "origin/main",
  });
  setWorktree(db, run.id, worktreePath, branchName);

  const token = newCallbackToken();
  db.update(runs).set({ callbackToken: token }).where(eq(runs.id, run.id)).run();

  const callbackUrl = `${deps.callbackBaseUrl}/${run.id}`;
  const metadata = (ticket.metadata ? JSON.parse(ticket.metadata) : null) as {
    acceptanceCriteria?: string[];
  } | null;
  const prompt = composeAgentPrompt({
    userPrompt: ticket.prompt,
    repoPath: ticket.repoPath,
    worktreePath,
    branchName,
    linearUrl: `https://linear.app/issue/${ticket.linearIdentifier}`,
    acceptanceCriteria: metadata?.acceptanceCriteria ?? [],
    callbackUrl,
  });

  const env = buildAgentEnv({ base: deps.baseEnv, runId: run.id, callbackUrl, callbackToken: token });
  const handle = deps.pty.spawn("claude-code", ["-p", prompt, "--dangerously-skip-permissions"], {
    cwd: worktreePath,
    env,
  });
  markRunning(db, run.id, handle.pid);

  let seq = 0;
  const buffer: string[] = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const text = buffer.join("");
    buffer.length = 0;
    appendLog(db, run.id, seq++, "stdout", Buffer.from(text));
  };
  const interval = setInterval(flush, 250);

  handle.onData((data) => {
    buffer.push(data);
    if (buffer.join("").length >= 64 * 1024) flush();
  });

  handle.onExit(({ exitCode }) => {
    clearInterval(interval);
    flush();
    // If the completion callback already set a terminal status, leave it.
    const current = getRunWithTicket(db, run.id)?.run;
    if (current && current.status === "running") {
      markTerminal(db, run.id, "failed", {
        exitCode,
        failureReason: "agent exited without status callback",
      });
    }
  });
}
