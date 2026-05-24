import type { StateMap } from "@/config/types";
import type { WorkflowState, WorkflowStateType } from "./gateway";

export interface ProposedStateMap {
  stateMap: Partial<StateMap>;
  warnings: string[];
}

export function proposeStateMap(states: WorkflowState[]): ProposedStateMap {
  const byType = (t: WorkflowStateType) =>
    states.filter((s) => s.type === t).sort((a, b) => a.position - b.position);

  const started = byType("started");
  const completed = byType("completed");
  const warnings: string[] = [];

  const inProgress = started[0]?.id;
  const done = completed[0]?.id;
  let inReview = started[1]?.id;

  if (!inProgress) warnings.push('No "started"-type state found for inProgress.');
  if (!done) warnings.push('No "completed"-type state found for done.');
  if (!inReview && inProgress) {
    inReview = inProgress;
    warnings.push('No second "started" state; inReview falls back to inProgress.');
  }

  return { stateMap: { inProgress, inReview, done }, warnings };
}

export function validateStateMap(
  stateMap: Partial<StateMap>,
  states: WorkflowState[],
): asserts stateMap is StateMap {
  const ids = new Set(states.map((s) => s.id));
  for (const key of ["inProgress", "inReview", "done"] as const) {
    const id = stateMap[key];
    if (!id) throw new Error(`stateMap.${key} is not set`);
    if (!ids.has(id)) {
      throw new Error(`stateMap.${key} (${id}) is not a known workflow state for this team`);
    }
  }
}
