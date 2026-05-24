import { join } from "node:path";
import { getDb } from "@/db/client";
import { getConfig } from "@/config";
import { getRunWithTicket } from "@/runs/service";
import { fetchOrigin, createWorktree, gcOldWorktrees } from "@/worktree/manager";
import { tick } from "./loop";
import { reapRuns } from "./reaper";
import { spawnAgent } from "./spawnAgent";
import { NodePtySpawner } from "./pty";

const db = getDb();
const config = getConfig();
const pty = new NodePtySpawner();
const worktreeRoot = join(process.env.HOME ?? process.cwd(), ".linear-orchestrator", "worktrees");
const port = process.env.LO_PORT ?? "3000";
const callbackBaseUrl = `http://localhost:${port}/api/runs`;

// Sweep stale worktrees once on boot (failed-run 7-day retention).
gcOldWorktrees(worktreeRoot, 7 * 24 * 60 * 60 * 1000);

const kill = (pid: number) => {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};

console.log(`[lo-worker] started; cap=${config.concurrencyCap} worktreeRoot=${worktreeRoot}`);

setInterval(() => {
  tick(db, config, {
    reap: () => reapRuns(db, config, { now: Date.now(), kill }),
    spawn: (run) => {
      const joined = getRunWithTicket(db, run.id);
      if (!joined) return;
      spawnAgent(db, run, joined.ticket, config, {
        pty,
        createWorktree,
        fetchOrigin,
        worktreeRoot,
        callbackBaseUrl,
        baseEnv: process.env,
      });
    },
  });
}, 500);
