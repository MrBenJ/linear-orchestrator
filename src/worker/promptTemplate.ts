export interface PromptContext {
  userPrompt: string;
  repoPath: string;
  worktreePath: string;
  branchName: string;
  linearUrl: string;
  acceptanceCriteria: string[];
  callbackUrl: string;
}

export function composeAgentPrompt(ctx: PromptContext): string {
  const acBlock =
    ctx.acceptanceCriteria.length > 0
      ? ["Acceptance criteria:", ...ctx.acceptanceCriteria.map((a) => `- ${a}`)].join("\n")
      : "";

  const footer = [
    "---",
    "[LO orchestrator context]",
    `- Target repo: ${ctx.repoPath}`,
    `- Worktree (your CWD): ${ctx.worktreePath}`,
    `- Feature branch: ${ctx.branchName} (already checked out)`,
    `- Linear ticket: ${ctx.linearUrl}`,
    acBlock,
    "",
    "When implementation is complete, invoke the /code-task skill to drive your work",
    "to a reviewed, merged PR. /code-task handles PR creation, code review with Aria,",
    "iteration on feedback, and merge.",
    "",
    `After /code-task finishes, POST to ${ctx.callbackUrl}/complete with header`,
    "Authorization: Bearer <LO_CALLBACK_TOKEN> and JSON body:",
    '  { "status": "success" | "failure", "prUrl": "...", "prMerged": true | false,',
    '    "summary": "...", "notes": "..." }',
    "Set prMerged:true only if the PR is actually merged.",
    "",
    `While working, POST every ~5 minutes to ${ctx.callbackUrl}/heartbeat with the same`,
    "Authorization header (empty body).",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return `${ctx.userPrompt}\n\n${footer}\n`;
}
