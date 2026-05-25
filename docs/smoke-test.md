# Manual smoke test (Phase 1)

End-to-end check against a real Linear sandbox + GitHub repo + claude-code. Run before a release.

## Prerequisites
- `.env.local` has `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `LO_API_TOKEN`, `ANTHROPIC_API_KEY`.
- A tunnel (ngrok/cloudflared) pointing at `localhost:$LO_PORT`.
- Linear webhook → `<tunnel>/api/webhooks/linear`; GitHub webhook (repo, `pull_request` events) → `<tunnel>/api/webhooks/github`.
- `~/.linear-orchestrator/config.json` has a `projectMappings` entry for your test project.

## Steps
1. Discover + write the team state map:
   ```bash
   export $(grep -v '^#' .env.local | xargs)   # load LINEAR_API_KEY etc. for the CLI
   pnpm lo linear states <teamId>               # eyeball the states
   pnpm lo linear bootstrap <teamId>            # writes stateMap into config.json
   ```
2. Start both processes: `pnpm dev:all`.
3. Create a ticket (the writing skill does this in Phase 2; for now, curl):
   ```bash
   curl -X POST localhost:$LO_PORT/api/tickets \
     -H "authorization: Bearer $LO_API_TOKEN" -H 'content-type: application/json' \
     -d '{"tickets":[{"linearTeamId":"<team>","linearProjectId":"<project>","title":"Smoke","prompt":"Add a hello function with a test.","harness":"claude-code"}]}'
   ```
4. Watch it: `pnpm lo status`, then `pnpm lo logs <run-id>`. The Linear issue moves to your `inProgress` state.
5. The agent runs `/code-task`, opens a PR, and posts `complete`. The issue moves to `inReview` (open PR) or `done` (auto-merged).
6. If the PR was left open, merge it on GitHub. The `pull_request` merge webhook drives the issue to `done`.
7. Confirm the worktree under `~/.linear-orchestrator/worktrees/<run-id>` is removed for a completed run.

## Pass criteria
- Linear issue progressed inProgress → inReview → done.
- A PR was opened and (eventually) merged.
- `lo logs` shows the captured agent output.
- A forced failure (e.g. an impossible prompt) lands the `lo:needs-human` label + a comment.
