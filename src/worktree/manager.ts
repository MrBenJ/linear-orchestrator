import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
}

/** `lo/<identifier>-<first 8 chars of runId>` */
export function branchNameFor(identifier: string, runId: string): string {
  return `lo/${identifier}-${runId.slice(0, 8)}`;
}

export interface CreateWorktreeInput {
  repoPath: string;
  worktreeRoot: string;
  runId: string;
  identifier: string;
  baseRef: string;
}

export interface CreatedWorktree {
  worktreePath: string;
  branchName: string;
}

export function fetchOrigin(repoPath: string): void {
  git(repoPath, ["fetch", "origin"]);
}

export function createWorktree(input: CreateWorktreeInput): CreatedWorktree {
  const branchName = branchNameFor(input.identifier, input.runId);
  const worktreePath = join(input.worktreeRoot, input.runId);
  git(input.repoPath, ["worktree", "add", worktreePath, "-b", branchName, input.baseRef]);
  return { worktreePath, branchName };
}

export function removeWorktree(repoPath: string, worktreePath: string): void {
  // --force handles a worktree with untracked/modified files; fall back to rm.
  try {
    git(repoPath, ["worktree", "remove", "--force", worktreePath]);
  } catch {
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
  }
}

/** Delete worktree directories older than maxAgeMs (failed-run retention sweep). */
export function gcOldWorktrees(worktreeRoot: string, maxAgeMs: number, now = Date.now()): string[] {
  if (!existsSync(worktreeRoot)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(worktreeRoot)) {
    const full = join(worktreeRoot, entry);
    const age = now - statSync(full).mtimeMs;
    if (age > maxAgeMs) {
      rmSync(full, { recursive: true, force: true });
      removed.push(full);
    }
  }
  return removed;
}
