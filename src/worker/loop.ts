import type { DB } from "@/db/client";
import type { Config } from "@/config/types";
import { claimNextQueuedRun, countRunning, type RunRow } from "@/runs/service";

export interface TickDeps {
  spawn: (run: RunRow) => void;
  reap: () => void;
}

/** One pass of the worker loop: reap, then fill open capacity from the queue. */
export function tick(db: DB, config: Config, deps: TickDeps): void {
  deps.reap();
  while (countRunning(db) < config.concurrencyCap) {
    const claimed = claimNextQueuedRun(db);
    if (!claimed) break;
    deps.spawn(claimed);
  }
}
