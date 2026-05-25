# LO setup (Phase 1a)

## Secrets — `.env.local` (gitignored)

```
LINEAR_API_KEY=lin_api_...
LINEAR_WEBHOOK_SECRET=...
LO_API_TOKEN=<random secret; required as `Authorization: Bearer` on POST /api/tickets>
LO_PORT=3000
```

## Runtime config — `~/.linear-orchestrator/config.json`

```json
{
  "concurrencyCap": 2,
  "projectMappings": [
    { "linearProjectId": "<project-uuid>", "repoPath": "/Users/me/code/myproject" }
  ],
  "teamMappings": [
    {
      "linearTeamId": "<team-uuid>",
      "stateMap": {
        "inProgress": "<state-uuid>",
        "inReview": "<state-uuid>",
        "done": "<state-uuid>"
      }
    }
  ],
  "orchestrationLabels": { "needsHuman": "lo:needs-human" }
}
```

`lo linear bootstrap` (added in plan 1b) will propose `stateMap` values from your
team's workflow states. Until then, fill them in by hand from Linear's settings.

## Smoke check (manual)

1. `pnpm dev`
2. ```
   curl -X POST localhost:3000/api/tickets \
     -H 'content-type: application/json' \
     -H "authorization: Bearer $LO_API_TOKEN" \
     -d '{"tickets":[{"linearTeamId":"<team>","linearProjectId":"<project>","title":"LO test","prompt":"noop","harness":"claude-code"}]}'
   ```
3. Confirm a new Linear issue appears in your "in progress" state and the response returns its identifier under `tickets`. A `502` with an `errors` array means one or more tickets failed (e.g. Linear rejected the issue); partially-created tickets are still listed under `tickets`.

## Running the worker (Phase 1b)

LO is two processes: the Next.js HTTP server and the `lo-worker` that supervises agents.

```bash
pnpm dev:all      # runs next dev + tsx watch src/worker/index.ts together
# or separately:
pnpm dev:web
pnpm dev:worker
```

The worker claims queued runs (up to `concurrencyCap`), creates a worktree under
`~/.linear-orchestrator/worktrees/<run-id>`, spawns `claude-code` via node-pty, and
reaps on timeout / heartbeat-loss / cancel. Agents call back to:

- `POST /api/runs/:id/heartbeat` and `POST /api/runs/:id/complete` — authed with the
  per-run `LO_CALLBACK_TOKEN` injected into the agent's environment.
- `POST /api/runs/:id/cancel` — operator-only, authed with `LO_API_TOKEN`.

Observe runs with the CLI:

```bash
pnpm lo status
pnpm lo logs <run-id> --from 0
pnpm lo kill <run-id>
pnpm lo config
```

> **node-pty note:** pnpm strips the executable bit from node-pty's prebuilt
> `spawn-helper`, which makes the worker fail with `posix_spawnp failed`. A
> `postinstall` hook (`scripts/fix-node-pty-perms.mjs`) restores it automatically on
> every `pnpm install`.

## GitHub merge webhook + team bootstrap (Phase 1c)

Register a GitHub webhook on each managed repo (or the org), `Content-Type: application/json`,
secret = `GITHUB_WEBHOOK_SECRET`, events = **Pull requests**, pointing at
`<tunnel>/api/webhooks/github`. On a `pull_request` merge, LO matches the run by its
`lo/<id>-<short-run-id>` head branch and transitions the ticket to your mapped `done` state.

Discover and write a team's workflow-state mapping (needs `LINEAR_API_KEY` in the env —
unlike the Next.js server, `tsx bin/lo.ts` does not auto-load `.env.local`):

```bash
export $(grep -v '^#' .env.local | xargs)
pnpm lo linear states <teamId>        # list states (id / type / name)
pnpm lo linear bootstrap <teamId>     # propose + write stateMap into config.json
```
