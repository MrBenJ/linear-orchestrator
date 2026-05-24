export type WorkflowStateType =
  | "triage"
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "canceled";

export interface WorkflowState {
  id: string;
  name: string;
  type: WorkflowStateType;
  position: number;
}

export interface CreateIssueInput {
  teamId: string;
  title: string;
  description?: string;
  projectId?: string;
  stateId?: string;
  labelIds?: string[];
}

export interface CreatedIssue {
  id: string;
  identifier: string;
  url: string;
}

export interface LinearGateway {
  createIssue(input: CreateIssueInput): Promise<CreatedIssue>;
  listWorkflowStates(teamId: string): Promise<WorkflowState[]>;
  updateIssueState(issueId: string, stateId: string): Promise<void>;
  ensureLabel(teamId: string, name: string): Promise<string>;
  addLabelToIssue(issueId: string, labelId: string): Promise<void>;
  createComment(issueId: string, body: string): Promise<void>;
}
