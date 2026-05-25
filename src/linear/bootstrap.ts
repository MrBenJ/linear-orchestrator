import { readFileSync, writeFileSync } from "node:fs";
import type { LinearGateway, WorkflowState } from "./gateway";
import { proposeStateMap } from "./stateMapping";
import type { StateMap } from "@/config/types";

export interface BuiltStateMap {
  stateMap: Partial<StateMap>;
  warnings: string[];
  states: WorkflowState[];
}

export async function buildTeamStateMap(linear: LinearGateway, teamId: string): Promise<BuiltStateMap> {
  const states = await linear.listWorkflowStates(teamId);
  const { stateMap, warnings } = proposeStateMap(states);
  return { stateMap, warnings, states };
}

interface ConfigShape {
  teamMappings?: Array<{ linearTeamId: string; stateMap: StateMap }>;
  [key: string]: unknown;
}

/** Read config JSON, upsert the team's stateMap, write it back (other fields preserved). */
export function upsertTeamMapping(configPath: string, teamId: string, stateMap: StateMap): void {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as ConfigShape;
  const mappings = config.teamMappings ?? [];
  const next = mappings.filter((m) => m.linearTeamId !== teamId);
  next.push({ linearTeamId: teamId, stateMap });
  config.teamMappings = next;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
