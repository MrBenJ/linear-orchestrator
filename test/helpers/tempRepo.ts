import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a throwaway git repo with one commit on `main`. Returns its path. */
export function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lo-repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  git("init", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(dir, "README.md"), "# temp\n");
  git("add", "-A");
  git("commit", "-m", "init");
  return dir;
}
