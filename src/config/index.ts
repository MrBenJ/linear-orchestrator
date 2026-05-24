import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configSchema, type Config, type StateMap } from "./types";

export function parseConfig(json: unknown): Config {
  return configSchema.parse(json);
}

export function loadConfig(filePath: string): Config {
  return parseConfig(JSON.parse(readFileSync(filePath, "utf8")));
}

export function resolveRepoPath(config: Config, linearProjectId: string | null): string | undefined {
  if (!linearProjectId) return undefined;
  return config.projectMappings.find((m) => m.linearProjectId === linearProjectId)?.repoPath;
}

export function resolveStateMap(config: Config, linearTeamId: string): StateMap | undefined {
  return config.teamMappings.find((m) => m.linearTeamId === linearTeamId)?.stateMap;
}

let cached: Config | undefined;

export function getConfig(): Config {
  if (!cached) {
    const home = process.env.HOME ?? process.cwd();
    const path = process.env.LO_CONFIG_PATH ?? join(home, ".linear-orchestrator", "config.json");
    cached = loadConfig(path);
  }
  return cached;
}

export type { Config, StateMap } from "./types";
