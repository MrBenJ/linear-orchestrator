import type {
  CreateIssueInput,
  CreatedIssue,
  LinearGateway,
  WorkflowState,
} from "@/linear/gateway";

export class FakeLinearGateway implements LinearGateway {
  createdIssues: CreateIssueInput[] = [];
  stateUpdates: Array<{ issueId: string; stateId: string }> = [];
  labelAdds: Array<{ issueId: string; labelId: string }> = [];
  comments: Array<{ issueId: string; body: string }> = [];
  states: WorkflowState[] = [];
  nextIssue: CreatedIssue = {
    id: "issue-1",
    identifier: "ENG-1",
    url: "https://linear.app/acme/issue/ENG-1",
  };
  failCreate = false;

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    if (this.failCreate) throw new Error("simulated Linear failure");
    this.createdIssues.push(input);
    return this.nextIssue;
  }
  async listWorkflowStates(): Promise<WorkflowState[]> {
    return this.states;
  }
  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    this.stateUpdates.push({ issueId, stateId });
  }
  async ensureLabel(_teamId: string, name: string): Promise<string> {
    return `label-${name}`;
  }
  async addLabelToIssue(issueId: string, labelId: string): Promise<void> {
    this.labelAdds.push({ issueId, labelId });
  }
  async createComment(issueId: string, body: string): Promise<void> {
    this.comments.push({ issueId, body });
  }
}
