import { and, eq, isNotNull, inArray } from "drizzle-orm";
import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { runs } from "@/db/schema";
import { markTerminal, type TerminalStatus } from "@/runs/service";

export interface ReaperEnv {
  now: number;
  kill: (pid: number) => void;
}

const TERMINAL: TerminalStatus[] = ["completed", "failed", "timed_out", "cancelled"];

export function reapRuns(db: DB, config: Config, env: ReaperEnv): void {
  // 1. Reap leftover processes for runs already in a terminal state (e.g. the
  //    completion callback marked it done but the child process lingers).
  const terminalWithPid = db
    .select()
    .from(runs)
    .where(and(inArray(runs.status, TERMINAL), isNotNull(runs.pid)))
    .all();
  for (const r of terminalWithPid) {
    if (r.pid != null) {
      env.kill(r.pid);
      db.update(runs).set({ pid: null }).where(eq(runs.id, r.id)).run();
    }
  }

  // 2. Evaluate live (running) runs for cancel / timeout / heartbeat death.
  const running = db.select().from(runs).where(eq(runs.status, "running")).all();
  for (const r of running) {
    const startedAt = r.startedAt ?? env.now;
    const ageMs = env.now - startedAt;
    const heartbeatAgeMs = env.now - (r.lastHeartbeatAt ?? startedAt);

    let kill: TerminalStatus | undefined;
    if (r.cancelRequested === 1) {
      kill = "cancelled";
    } else if (ageMs > config.defaultRunTimeoutMs) {
      kill = "timed_out";
    } else if (ageMs > config.heartbeatIntervalMs && heartbeatAgeMs > config.heartbeatGraceMs) {
      kill = "timed_out";
    }

    if (kill) {
      if (r.pid != null) env.kill(r.pid);
      markTerminal(db, r.id, kill, {
        failureReason: kill === "cancelled" ? "cancelled by operator" : "killed: timeout/heartbeat",
      });
    }
  }
}
