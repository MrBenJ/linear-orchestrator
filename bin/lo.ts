import { join } from "node:path";
import { parseArgs, formatRunsTable, baseUrl, type RunSummary } from "@/cli/client";
import { loadConfig } from "@/config";

function requireToken(): string {
  const token = process.env.LO_API_TOKEN;
  if (!token) throw new Error("LO_API_TOKEN not set");
  return token;
}

async function main(): Promise<void> {
  const { cmd, arg, from } = parseArgs(process.argv.slice(2));

  switch (cmd) {
    case "status": {
      const res = await fetch(`${baseUrl()}/runs`, {
        headers: { authorization: `Bearer ${requireToken()}` },
      });
      const { runs } = (await res.json()) as { runs: RunSummary[] };
      console.log(formatRunsTable(runs));
      break;
    }
    case "logs": {
      if (!arg) throw new Error("usage: lo logs <run-id> [--from N]");
      const res = await fetch(`${baseUrl()}/runs/${arg}/logs?from=${from}`, {
        headers: { authorization: `Bearer ${requireToken()}` },
      });
      const { logs } = (await res.json()) as { logs: Array<{ text: string }> };
      process.stdout.write(logs.map((l) => l.text).join(""));
      process.stdout.write("\n");
      break;
    }
    case "kill": {
      if (!arg) throw new Error("usage: lo kill <run-id>");
      const res = await fetch(`${baseUrl()}/runs/${arg}/cancel`, {
        method: "POST",
        headers: { authorization: `Bearer ${requireToken()}` },
      });
      console.log(res.status === 202 ? `cancellation requested for ${arg}` : `failed: ${res.status}`);
      break;
    }
    case "config": {
      const path =
        process.env.LO_CONFIG_PATH ??
        join(process.env.HOME ?? process.cwd(), ".linear-orchestrator", "config.json");
      console.log(JSON.stringify(loadConfig(path), null, 2));
      break;
    }
    default:
      console.log("usage: lo <status|logs <id>|kill <id>|config>");
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
