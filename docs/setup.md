# LO setup (Phase 1a)

## Secrets — `.env.local` (gitignored)

```
LINEAR_API_KEY=lin_api_...
LINEAR_WEBHOOK_SECRET=...
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
     -d '{"tickets":[{"linearTeamId":"<team>","linearProjectId":"<project>","title":"LO test","prompt":"noop","harness":"claude-code"}]}'
   ```
3. Confirm a new Linear issue appears in your "in progress" state and the response returns its identifier.
