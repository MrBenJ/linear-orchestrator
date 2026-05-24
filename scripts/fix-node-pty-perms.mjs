// pnpm strips the executable bit from node-pty's prebuilt `spawn-helper` during
// package extraction, which makes node-pty fail at runtime with
// "Error: posix_spawnp failed." (the native addon can't exec the helper).
// Restore +x on every install. Safe no-op when node-pty isn't present.
import { readdirSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";

function helpersUnder(nodePtyDir) {
  const found = [];
  for (const sub of ["prebuilds", "build/Release", "build/Debug"]) {
    const base = join(nodePtyDir, sub);
    if (!existsSync(base)) continue;
    if (sub === "prebuilds") {
      for (const platform of readdirSync(base)) {
        const helper = join(base, platform, "spawn-helper");
        if (existsSync(helper)) found.push(helper);
      }
    } else {
      const helper = join(base, "spawn-helper");
      if (existsSync(helper)) found.push(helper);
    }
  }
  return found;
}

const dirs = [];
// Hoisted / npm layout.
if (existsSync(join("node_modules", "node-pty"))) dirs.push(join("node_modules", "node-pty"));
// pnpm content-addressed layout: node_modules/.pnpm/node-pty@<ver>/node_modules/node-pty
const pnpmDir = join("node_modules", ".pnpm");
if (existsSync(pnpmDir)) {
  for (const entry of readdirSync(pnpmDir)) {
    if (entry.startsWith("node-pty@")) {
      dirs.push(join(pnpmDir, entry, "node_modules", "node-pty"));
    }
  }
}

let fixed = 0;
for (const dir of dirs) {
  for (const helper of helpersUnder(dir)) {
    chmodSync(helper, 0o755);
    fixed += 1;
    console.log(`[fix-node-pty-perms] chmod +x ${helper}`);
  }
}
if (fixed === 0) console.log("[fix-node-pty-perms] no node-pty spawn-helper found (ok)");
