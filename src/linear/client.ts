import { LinearClient as LinearSdk } from "@linear/sdk";
import type {
  CreateIssueInput,
  CreatedIssue,
  LinearGateway,
  WorkflowState,
  WorkflowStateType,
} from "./gateway";

export class LinearSdkGateway implements LinearGateway {
  constructor(private readonly sdk: LinearSdk) {}

  async createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    const payload = await this.sdk.createIssue(input);
    const issue = await payload.issue;
    if (!issue) throw new Error("createIssue returned no issue");
    return { id: issue.id, identifier: issue.identifier, url: issue.url };
  }

  async listWorkflowStates(teamId: string): Promise<WorkflowState[]> {
    const conn = await this.sdk.workflowStates({ filter: { team: { id: { eq: teamId } } } });
    return conn.nodes.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type as WorkflowStateType,
      position: s.position,
    }));
  }

  async updateIssueState(issueId: string, stateId: string): Promise<void> {
    await this.sdk.updateIssue(issueId, { stateId });
  }

  async ensureLabel(teamId: string, name: string): Promise<string> {
    const existing = await this.sdk.issueLabels({
      filter: { team: { id: { eq: teamId } }, name: { eq: name } },
    });
    if (existing.nodes.length > 0) return existing.nodes[0].id;
    const payload = await this.sdk.createIssueLabel({ teamId, name });
    const label = await payload.issueLabel;
    if (!label) throw new Error("createIssueLabel returned no label");
    return label.id;
  }

  async addLabelToIssue(issueId: string, labelId: string): Promise<void> {
    const issue = await this.sdk.issue(issueId);
    const labels = await issue.labels();
    const ids = labels.nodes.map((l) => l.id);
    if (ids.includes(labelId)) return;
    await this.sdk.updateIssue(issueId, { labelIds: [...ids, labelId] });
  }

  async createComment(issueId: string, body: string): Promise<void> {
    await this.sdk.createComment({ issueId, body });
  }
}

let cached: LinearGateway | undefined;

export function getLinearGateway(): LinearGateway {
  if (!cached) {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) throw new Error("LINEAR_API_KEY is not set");
    cached = new LinearSdkGateway(new LinearSdk({ apiKey }));
  }
  return cached;
}
