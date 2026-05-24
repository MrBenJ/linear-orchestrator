import { describe, it, expect, afterEach } from "vitest";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTempRepo } from "../../test/helpers/tempRepo";
import { branchNameFor, createWorktree, removeWorktree } from "./manager";

const cleanup: string[] = [];
afterEach(() => {
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("worktree manager", () => {
  it("builds a namespaced branch name with a short run-id suffix", () => {
    expect(branchNameFor("ENG-123", "7a3f1c2d-aaaa")).toBe("lo/ENG-123-7a3f1c2d");
  });

  it("creates a worktree on a new branch from the base ref, then removes it", () => {
    const repo = makeTempRepo();
    cleanup.push(repo);
    const root = mkdtempSync(join(tmpdir(), "lo-wt-"));
    cleanup.push(root);

    const { worktreePath, branchName } = createWorktree({
      repoPath: repo, worktreeRoot: root, runId: "run-1234-xyz",
      identifier: "ENG-1", baseRef: "main",
    });
    expect(existsSync(join(worktreePath, "README.md"))).toBe(true);
    expect(branchName).toBe("lo/ENG-1-run-1234");

    removeWorktree(repo, worktreePath);
    expect(existsSync(worktreePath)).toBe(false);
  });
});
