import type { WorkflowState } from "@/linear/gateway";

export interface ParsedArgs {
  cmd: string | undefined;
  arg: string | undefined;
  from: number;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const cmd = argv[0];
  const arg = argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined;
  const fromIdx = argv.indexOf("--from");
  const from = fromIdx >= 0 ? Number(argv[fromIdx + 1] ?? "0") : 0;
  return { cmd, arg, from: Number.isFinite(from) ? from : 0 };
}

export interface RunSummary {
  id: string;
  status: string;
  branchName: string | null;
  startedAt: number | null;
  createdAt: number;
}

export function formatRunsTable(runs: RunSummary[]): string {
  if (runs.length === 0) return "(no active runs)";
  const rows = runs.map((r) => `${r.id}  ${r.status.padEnd(9)}  ${r.branchName ?? "-"}`);
  return ["ID                                    STATUS     BRANCH", ...rows].join("\n");
}

export function baseUrl(): string {
  return `http://localhost:${process.env.LO_PORT ?? "3000"}/api`;
}

export function parseLinearSubcommand(argv: string[]): {
  sub: string | undefined;
  teamId: string | undefined;
} {
  // argv like ["linear", "states", "team-1"]
  return { sub: argv[1], teamId: argv[2] };
}

export function formatWorkflowStates(states: WorkflowState[]): string {
  if (states.length === 0) return "(no workflow states)";
  return states
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.id}  ${s.type.padEnd(10)}  ${s.name}`)
    .join("\n");
}
