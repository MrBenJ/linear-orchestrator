import type { LinearGateway } from "./gateway";
import type { StateMap } from "@/config/types";

export interface RunOutcome {
  status: "success" | "failure";
  prUrl?: string;
  prMerged?: boolean;
  summary?: string;
  notes?: string;
}

export interface ApplyOutcomeInput {
  issueId: string;
  teamId: string;
  stateMap: StateMap;
  needsHumanLabel: string;
  outcome: RunOutcome;
}

export async function applyRunOutcome(linear: LinearGateway, input: ApplyOutcomeInput): Promise<void> {
  const { issueId, teamId, stateMap, needsHumanLabel, outcome } = input;

  if (outcome.status === "success") {
    const stateId = outcome.prMerged ? stateMap.done : stateMap.inReview;
    await linear.updateIssueState(issueId, stateId);
    return;
  }

  // Failure: label needs-human and comment; leave the workflow state untouched.
  const labelId = await linear.ensureLabel(teamId, needsHumanLabel);
  await linear.addLabelToIssue(issueId, labelId);
  const body = [outcome.summary, outcome.notes].filter(Boolean).join("\n\n") || "Run failed.";
  await linear.createComment(issueId, body);
}
