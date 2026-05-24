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
  /** Throw on the Nth createIssue call (1-based); null disables. */
  failCreateOnCall: number | null = null;
  failStateUpdate = false;
  createCallCount = 0;

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    this.createCallCount += 1;
    if (this.failCreate || this.createCallCount === this.failCreateOnCall) {
      throw new Error("simulated Linear createIssue failure");
    }
    this.createdIssues.push(input);
    return this.nextIssue;
  }
  async listWorkflowStates(): Promise<WorkflowState[]> {
    return this.states;
  }
  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    if (this.failStateUpdate) throw new Error("simulated state update failure");
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
