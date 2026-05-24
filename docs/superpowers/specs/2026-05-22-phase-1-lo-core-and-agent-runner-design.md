# Phase 1: LO Core + Agent Runner — Design Spec

**Status:** Draft (awaiting user review)
**Parent:** [Architecture overview](../../architecture.md)
**Next:** Implementation plan via `superpowers:writing-plans`

## Scope

The end-to-end backbone of Linear Orchestrator. After Phase 1, a ticket created via HTTP POST to LO will cause an agent to run in an isolated worktree, drive itself through `/code-task` to a PR, and report completion. No web UI, no writing skill, no QA flow — those are later phases.

### In scope

1. Next.js 15 app (App Router) — HTTP layer only
2. Separate `lo-worker` Node process — owns agent lifecycle
3. SQLite store via Drizzle ORM
4. Linear API client (create ticket, transition state, manage labels, post comment)
5. Linear webhook receiver with HMAC signature verification
6. GitHub webhook receiver (PR merge events) → drives ticket to `done`
7. `claude-code` agent runner (codex deferred to Phase 1.5)
8. `node-pty`-based agent capture
9. Git worktree management
10. Configurable concurrency cap
11. Per-run timeout + heartbeat-based liveness
12. Status callback API
13. Config loading (`~/.linear-orchestrator/config.json`)
14. Minimal CLI: `lo logs <run-id>`, `lo status`, `lo kill <run-id>`, `lo linear bootstrap`
15. Unit + integration tests

### Out of scope (Phase 1)

- Web UI
- Writing skill (skill side; LO's HTTP endpoint exists)
- QA agent / post-merge flow
- Codex harness (single harness, claude-code, in Phase 1)
- SSE log streaming endpoint (CLI replay is enough)
- Auto-retry on failure
- Cross-repo tickets

## Decisions

| Topic | Choice |
|-------|--------|
| Runtime shape | Next.js HTTP process + separate `lo-worker` process |
| Agent capture | `node-pty` |
| DB | SQLite (`better-sqlite3`) + Drizzle ORM |
| Prompt shape | User-authored prompt + LO-injected footer |
| Success signal | Agent POSTs to status callback API |
| Stuck-agent handling | Per-run wall-clock timeout + periodic heartbeat |
| Repo mapping | `linearProjectId → repoPath`, defined in config file |
| State mapping | `linearTeamId → { inProgress, inReview, done }` mapped to that team's workflow-state IDs. Auto-discovered, user-overridable. No hardcoded state names. |
| Orchestration signals | Failure/timeout/needs-human are **labels** (`lo:needs-human`), not workflow states — labels are universal and API-creatable. States express workflow position; labels express LO metadata. |
| Transition ownership | LO drives all transitions (user does not use Linear's GitHub integration): `inProgress` on start, `inReview` on PR-open. `done` is driven by a **GitHub→LO webhook** on PR merge — reliable whether `/code-task` auto-merges or a human merges later. |
| Concurrency | Single integer cap in config, default 2 |
| Webhook ingress | External tunnel (ngrok/cloudflared), user-managed |
| Branch naming | `lo/<ticket-identifier>-<short-run-id>` (e.g., `lo/ENG-123-7a3f`) — allows manual re-runs without branch collisions |
| Worktree location | `~/.linear-orchestrator/worktrees/<run-id>/` |
| Worktree cleanup | On `completed`: remove. On `failed`/`timed_out`: retain 7 days then GC. |
| Trigger model | LO enqueues runs synchronously on `POST /api/tickets`. Webhooks are used only for state-sync (merge events, manual transitions). |

## Architecture

Two processes, one DB, one config file.

```
┌─────────────────────────────────────┐
│ Next.js (HTTP)                       │
│  - POST /api/tickets                 │
│  - POST /api/webhooks/linear         │
│  - POST /api/webhooks/github         │
│  - POST /api/runs/:id/complete       │
│  - POST /api/runs/:id/heartbeat      │
│  - GET  /api/runs/:id                │
│  - GET  /api/runs/:id/logs           │
└────────────┬─────────────────────────┘
             │ writes runs (status=queued)
             ▼
┌─────────────────────────────────────┐
│ SQLite (state.db) ◀──── shared ──┐  │
└─────────────────────────────────────┘
             ▲                       │
             │ polls for queued runs │
             ▼                       │
┌─────────────────────────────────────┐
│ lo-worker (Node)                     │
│  - Polls runs table                  │
│  - Acquires run (UPDATE … RETURNING) │
│  - Creates worktree                  │
│  - Spawns node-pty(claude-code)      │
│  - Streams PTY → agent_logs          │
│  - Watches timeout + heartbeat       │
│  - Reaps on exit / callback / timeout│
└─────────────────────────────────────┘
```

Both processes are started by `pnpm dev` (concurrent). In production, the user runs them under a process manager of their choice (`pm2`, `systemd`, plain `&`).

### Why a separate worker

- HTTP layer can restart (code reload, errors) without killing in-flight agents.
- The polling model is dead simple; no IPC besides the DB.
- Worker can scale-up later (multiple worker processes claiming runs) without changing the HTTP layer.

## Data model

Tables (Drizzle schema lives in `src/db/schema.ts`):

### `tickets`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | UUID generated by LO |
| `linear_issue_id` | text unique | Linear's issue UUID |
| `linear_identifier` | text | e.g., `ENG-123` |
| `linear_team_id` | text | Required by Linear to create an issue; drives state mapping |
| `linear_project_id` | text | nullable; drives repo resolution |
| `repo_path` | text | Resolved from project mapping at creation |
| `harness` | text | `claude-code` (Phase 1 only value) |
| `prompt` | text | User-authored prompt body |
| `metadata` | text (JSON) | Title, description, AC, labels — for audit |
| `created_at` | integer | unix ms |

### `runs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | text PK | UUID |
| `ticket_id` | text FK | |
| `status` | text | `queued`, `running`, `completed`, `failed`, `timed_out`, `cancelled` |
| `worktree_path` | text | |
| `branch_name` | text | |
| `pid` | integer | PTY child PID; null until running |
| `started_at` | integer | |
| `last_heartbeat_at` | integer | nullable |
| `completed_at` | integer | nullable |
| `exit_code` | integer | nullable |
| `result` | text (JSON) | nullable; from status callback |
| `pr_url` | text | nullable; reported by status callback |
| `pr_number` | integer | nullable; parsed from `pr_url`; used to match GitHub merge webhooks |
| `pr_state` | text | nullable; `open`, `merged` |
| `failure_reason` | text | nullable; freeform |
| `callback_token` | text | random secret passed to the agent; required on callbacks |

### `agent_logs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer PK auto | |
| `run_id` | text FK | |
| `seq` | integer | monotonic per run |
| `ts` | integer | unix ms |
| `stream` | text | `stdout` or `stderr` |
| `chunk` | blob | raw PTY bytes |

Indexed on `(run_id, seq)`.

### `config`

Single-row table mirroring `~/.linear-orchestrator/config.json` for transactional updates. Persisted to disk on write.

| Column | Type | Notes |
|--------|------|-------|
| `id` | integer PK (always 1) | |
| `concurrency_cap` | integer | default 2 |
| `default_run_timeout_ms` | integer | default 60 * 60 * 1000 |
| `heartbeat_interval_ms` | integer | default 5 * 60 * 1000 |
| `heartbeat_grace_ms` | integer | default 10 * 60 * 1000 |
| `project_mappings` | text (JSON) | `[{ linearProjectId, repoPath }]` |
| `team_mappings` | text (JSON) | `[{ linearTeamId, stateMap: { inProgress, inReview, done } }]` — values are Linear workflow-state IDs |
| `orchestration_labels` | text (JSON) | `{ needsHuman: "lo:needs-human" }` — label names LO ensures exist per team |

## HTTP API

All bodies are JSON.

### `POST /api/tickets`

Called by the writing skill. Idempotent on `clientRequestId` if provided.

**Request:**

```json
{
  "tickets": [
    {
      "linearTeamId": "...",
      "linearProjectId": "...",
      "title": "Add foo to bar",
      "description": "...",
      "acceptanceCriteria": ["..."],
      "prompt": "Implement foo in bar/foo.ts. Tests under bar/foo.test.ts.",
      "harness": "claude-code",
      "labels": ["lo"]
    }
  ]
}
```

**Response:**

```json
{
  "tickets": [
    {
      "id": "lo-uuid",
      "linearUrl": "https://linear.app/team/issue/ENG-123",
      "linearIdentifier": "ENG-123",
      "runId": "run-uuid"
    }
  ]
}
```

**Behavior:**
1. Validate `linearTeamId` against `team_mappings` (must have a resolved `stateMap`) and `linearProjectId` against `project_mappings` (must resolve a `repoPath`). Reject unknown team or project.
2. Create the Linear issue via Linear API (team is required; project optional).
3. Insert `tickets` and `runs` rows. Run status = `queued`.
4. Transition the Linear issue to the team's mapped `inProgress` state ID. (For simplicity Phase 1 does this on enqueue; the worker re-asserts it on actual start.)
5. Return.

### `POST /api/webhooks/linear`

Verifies HMAC against `LINEAR_WEBHOOK_SECRET`. Phase 1 handles only:

- `Issue` state changes — when LO-tracked tickets transition (e.g., the user manually moves a ticket in Linear). LO records the transition for audit; in Phase 1 no further action. Note: LO does **not** learn about PR merges from this webhook — merge detection comes from the agent's status callback (see below), because the user does not run Linear's GitHub integration.

Unknown events are logged and acknowledged with `200`.

### `POST /api/webhooks/github`

Verifies HMAC (`X-Hub-Signature-256`) against `GITHUB_WEBHOOK_SECRET`. Phase 1 handles only:

- `pull_request` events with `action: closed` and `merged: true`. LO matches the PR to a ticket by `pr_number` + repo (stored on the run from the status callback; falls back to matching the head branch `lo/<identifier>-<short-run-id>`). On match: set `runs.pr_state = merged` and transition the ticket to the team's `done` state.

This is the authoritative `done` signal and works whether `/code-task` auto-merged or a human merged later. The handler is a lightweight state-flip — it needs only the stored PR linkage, not the worktree (which may already be cleaned). Unmatched or unknown events → logged, `200`.

The user registers this webhook on the relevant GitHub repos (or org), pointing at the same tunnel as Linear's, path `/api/webhooks/github`.

### `POST /api/runs/:id/heartbeat`

Called by the spawned agent. Authenticated by header `Authorization: Bearer <callback_token>`.

**Request:** empty.
**Response:** `204`.
**Behavior:** updates `runs.last_heartbeat_at = now()`.

### `POST /api/runs/:id/complete`

Called by the spawned agent. Authenticated by `callback_token`.

**Request:**

```json
{
  "status": "success" | "failure",
  "prUrl": "https://github.com/...",
  "prMerged": true,
  "summary": "Implemented foo. PR #123 merged via /code-task.",
  "notes": "..."
}
```

**Behavior:**
1. Validate bearer token against `runs.callback_token`.
2. Update `runs.result` and `runs.completed_at`. The run's `status` column moves to `completed` when the callback body's `status` is `"success"`, otherwise to `failed`.
3. Store PR linkage: set `runs.pr_url`, parse and set `runs.pr_number`, set `runs.pr_state` (`merged` if `prMerged`, else `open`).
4. Drive the Linear ticket based on the outcome, using the team's `stateMap`:
   - `status: success` + `prMerged: true` → transition to `done`.
   - `status: success` + `prMerged: false` (PR open / merge-ready) → transition to `inReview`. The eventual merge — whether by `/code-task` later or by a human — is detected by the GitHub merge webhook, which then drives the ticket to `done`.
   - `status: failure` → apply the `needsHuman` label, leave the workflow state where it is, and post `summary` + `notes` as a Linear comment.
5. The worker observes the row's status change on its next poll and reaps the child process if it's still alive.

### `GET /api/runs/:id` and `GET /api/runs/:id/logs`

Read endpoints. `logs` supports `?from=<seq>` for incremental fetch (used by the CLI).

## Worker behavior

The worker is a single file (`src/worker/index.ts`) that runs an infinite loop:

```text
while (true) {
  reapTimeoutsAndHeartbeats()       // any running run past deadline → kill, mark timed_out
  reapCompletedRuns()                // any run with status=completed/failed → SIGTERM if pid alive
  if (countRunning() < concurrencyCap) {
    claimNextQueuedRun()             // SQLite UPDATE … WHERE status='queued' LIMIT 1 RETURNING
                                     // claim atomically by setting status='running'
    spawnAgent(claimed)              // see below
  }
  sleep(500 ms)
}
```

### `spawnAgent(run)`

1. Resolve `repo_path` from ticket; `git -C <repo> fetch origin` (do not touch the user's primary worktree).
2. `git -C <repo> worktree add ~/.linear-orchestrator/worktrees/<run.id> -b lo/<ticket.linear_identifier>-<short-run-id> origin/main`. Branching explicitly from `origin/main` makes the worktree independent of whatever the user has checked out in their main worktree.
3. Compose prompt (see below).
4. Generate `callback_token` (32 random bytes, base64url), write to `runs.callback_token`.
5. Spawn via `node-pty.spawn('claude-code', ['-p', prompt, '--dangerously-skip-permissions'], { cwd: worktree, env: agentEnv })`, where `agentEnv` is described below. **Note on permissions:** headless `claude-code` cannot prompt the user for permission, so it must run with permission bypass to execute tests, git commits, `gh` CLI, etc. The blast radius is bounded by the isolated worktree — the agent cannot touch the user's primary checkout, other repos, or arbitrary system paths beyond what it could already do in a normal session.
6. Pipe PTY data into `agent_logs` via batched inserts (every 250 ms or 64 KB).
7. Update `runs.pid`, `runs.started_at`.
8. On child exit, transition to terminal state if not already set by callback. If callback never came: run status becomes `failed` with `failure_reason = "agent exited without status callback"`.

### `agentEnv`

The spawned process inherits LO's env plus:

| Var | Purpose |
|-----|---------|
| `LO_RUN_ID` | The run UUID |
| `LO_CALLBACK_URL` | `http://localhost:<LO_PORT>/api/runs/<run.id>` |
| `LO_CALLBACK_TOKEN` | The bearer token for callback auth |
| `GITHUB_TOKEN` | Propagated from LO's `.env.local` so the agent can `gh pr create`, `git push`, etc. |
| `ANTHROPIC_API_KEY` | If present in LO's env, forwarded. (claude-code on a subscriber's machine typically uses local subscription auth; the var is forwarded for environments where API-key auth applies.) |

**Cost note:** spawning `claude-code -p` for autonomous work consumes the same subscription secondary-tier credits we deliberately avoided for prompt entry. The trade is intentional — autonomous task execution justifies the cost; manual prompt entry does not.

### Concurrency

The `claimNextQueuedRun` SQL uses `UPDATE … WHERE id IN (SELECT id FROM runs WHERE status='queued' ORDER BY created_at LIMIT 1) RETURNING *`. SQLite serializes writes, so two workers (or one worker racing itself) can't double-claim. Phase 1 ships one worker; the SQL is correct under future fan-out.

### Timeout + heartbeat

- Wall-clock: `now() - started_at > config.default_run_timeout_ms` → SIGTERM (grace 10s) → SIGKILL → status = `timed_out`.
- Heartbeat: if `last_heartbeat_at` is older than `heartbeat_grace_ms` AND the run has been running longer than `heartbeat_interval_ms`, treat as silently hung. Same kill cascade.

## Prompt template

The user-authored `prompt` is the body. LO appends a footer:

```text
---
[LO orchestrator context]
- Target repo: <repo_path>
- Worktree (your CWD): <worktree_path>
- Feature branch: lo/<ticket_identifier>-<short_run_id> (already checked out)
- Linear ticket: <linear_url>
- Acceptance criteria:
  - <ac_item_1>
  - <ac_item_2>

When implementation is complete, invoke the /code-task skill to drive your work
to a reviewed, merged PR. /code-task will handle PR creation, code review with
Aria, iteration on feedback, and merge.

After /code-task finishes (PR is merged or marked merge-ready), POST to:
  POST <LO_CALLBACK_URL>/complete
  Authorization: Bearer <LO_CALLBACK_TOKEN>
  Body: { "status": "success" | "failure", "prUrl": "...", "prMerged": true | false, "summary": "...", "notes": "..." }
  (Set prMerged:true only if the PR is actually merged. If you left it open/merge-ready, set false.)

While working, POST a heartbeat every ~5 minutes:
  POST <LO_CALLBACK_URL>/heartbeat
  Authorization: Bearer <LO_CALLBACK_TOKEN>
```

(Env vars `LO_RUN_ID`, `LO_CALLBACK_URL`, `LO_CALLBACK_TOKEN` are also set in the spawned process for tools that prefer env over prompt.)

## Configuration

### `~/.linear-orchestrator/config.json`

```json
{
  "concurrencyCap": 2,
  "defaultRunTimeoutMs": 3600000,
  "heartbeatIntervalMs": 300000,
  "heartbeatGraceMs": 600000,
  "projectMappings": [
    { "linearProjectId": "abc-123", "repoPath": "/Users/me/code/myproject" }
  ],
  "teamMappings": [
    {
      "linearTeamId": "team-uuid",
      "stateMap": {
        "inProgress": "state-uuid-started",
        "inReview": "state-uuid-review",
        "done": "state-uuid-completed"
      }
    }
  ],
  "orchestrationLabels": { "needsHuman": "lo:needs-human" }
}
```

On startup, the worker upserts this into the `config` table. Live edits are picked up by re-reading the file every 30 s OR via a `PATCH /api/config` endpoint (deferred to Phase 2).

See **Linear workflow state mapping** below for how `stateMap` values are discovered.

### `.env.local` (in LO repo, gitignored)

```
LINEAR_API_KEY=...
LINEAR_WEBHOOK_SECRET=...
GITHUB_TOKEN=...
GITHUB_WEBHOOK_SECRET=...
ANTHROPIC_API_KEY=...
LO_PORT=3000
```

## Linear workflow state mapping

Linear has no universal "In Progress" or "Done". Each **team** defines its own ordered workflow states, each with a `type` (`triage` | `backlog` | `unstarted` | `started` | `completed` | `canceled`) and a custom name. A team may have several states of the same type (e.g., three `started` states: "In Dev", "Code Review", "QA"). LO therefore never matches on state *names* — it resolves a small set of semantic states to concrete state IDs per team.

**Semantic states LO drives:** `inProgress`, `inReview`, `done`. (LO does not have a `todo` mapping — the issue's creation state is whatever Linear assigns; LO only moves it forward.)

**Auto-discovery + bootstrap.** LO queries the team's workflow states via the Linear API (`workflowStates`, each carries `id`, `name`, `type`, `position`). It proposes defaults:

- `inProgress` → first `started`-type state by position
- `done` → first `completed`-type state by position
- `inReview` → second `started`-type state if one exists, else falls back to `inProgress` (LO will note the fallback)

The user reviews and overrides via `lo linear bootstrap <teamId>`, which writes the resolved `stateMap` into `config.json`. If a required mapping can't be resolved and isn't overridden, LO refuses to create tickets for that team (fail loud, not silent).

**Labels, not states, for exceptions.** `needsHuman` (and future `failed`/`timed-out` signals) are Linear **labels**, not states. LO ensures the label exists per team on startup (create-if-missing via API). Rationale: labels are universal and don't require the user to maintain a matching custom workflow state, and they layer on top of whatever state the issue is in rather than overwriting workflow position.

## CLI

A small wrapper at `bin/lo.ts` (compiled to `bin/lo.mjs`). Talks to LO over HTTP.

| Command | Behavior |
|---------|----------|
| `lo status` | Lists active runs with status + age |
| `lo logs <run-id>` | Streams agent_logs for a run (tails by default) |
| `lo kill <run-id>` | POSTs cancel; worker reaps |
| `lo config` | Prints effective config |
| `lo linear states <teamId>` | Lists a team's workflow states (id, name, type) — for filling in the state map |
| `lo linear bootstrap <teamId>` | Proposes a default `stateMap` and writes it to config after confirmation |

## Failure modes

| Failure | LO response |
|---------|-------------|
| Team has no resolvable `stateMap` and no override | `POST /api/tickets` rejected with a clear error naming the team; nothing persisted |
| Linear API call fails on ticket create | Return 5xx to skill; nothing persisted |
| Worktree creation fails (dirty tree, branch exists) | Run → `failed`, `lo:needs-human` label + Linear comment |
| Agent process crashes (non-zero exit) without callback | Run → `failed`, `lo:needs-human` label + last 50 log lines as Linear comment |
| Agent exits cleanly without callback | Run → `failed`, reason = "no callback", `lo:needs-human` label + comment |
| Heartbeat lapses | Kill cascade, run → `timed_out`, `lo:needs-human` label + comment |
| Wall-clock exceeded | Kill cascade, run → `timed_out`, `lo:needs-human` label + comment |
| HTTP layer crashes | Worker keeps running; agent continues; on HTTP restart, callback retries succeed (agents should retry with backoff for ~5 min) |
| Worker crashes | All running agents become orphans (their PIDs are still in DB); on worker restart, mark all `running` rows with no recent log activity as `failed` with reason "worker restarted" |
| Disk full | SQLite write fails; current run errors; surfaced as `failed` |

## Testing strategy

- **Unit tests** (Vitest): Linear client mocked; prompt composer; status state machine; signature verification.
- **Integration tests**: in-memory SQLite (via `:memory:`); fake "echo agent" — a small Node script that pretends to be claude-code (reads prompt from argv, sleeps briefly, POSTs heartbeat, POSTs complete). Tests assert correct DB transitions, log capture, timeout behavior (with shortened timeouts).
- **Linear contract test**: behind a flag (`LO_E2E_LINEAR=1`), against a real Linear sandbox workspace. Skipped in CI; runs locally before release.
- **No real claude-code in tests** — the echo agent is the stand-in. A separate manual smoke test (documented in `docs/smoke-test.md`) walks through one real ticket end-to-end.

## Open items / sensible defaults

These are decided in this spec; calling out so they're not surprises during implementation:

- **Default concurrency cap = 2.** Tunable in config.
- **Default run timeout = 1 hour.** Long enough for typical /code-task flows; killable from CLI if needed.
- **Branch naming = `lo/<linear-identifier>`.** Predictable, namespaced.
- **No SSE in Phase 1.** CLI tails logs by polling `?from=<seq>`. SSE arrives with the UI.
- **Single harness (claude-code).** Codex deferred to Phase 1.5 once the spawn-strategy interface is settled.
- **Worktree retention on failure = 7 days.** GC sweep runs on worker startup.
- **State names are never hardcoded.** Transitions resolve through the per-team `stateMap`. Exceptions are labels, not states.
- **Merge detection is in Phase 1 via a GitHub→LO webhook.** Because merge behavior is configurable (sometimes `/code-task` auto-merges, sometimes a human merges), `done` is driven by the GitHub `pull_request` merge event, not by guessing from the status callback alone. This is independent of Linear (the GitHub integration isn't used). The same webhook will be reused by the Phase 3 QA flow, which triggers on merge.

## Acceptance criteria

Phase 1 is done when:

1. `POST /api/tickets` with a valid ticket creates a Linear issue, an LO run, and the worker picks it up within 1 second.
2. The spawned agent runs in an isolated worktree on a fresh `lo/<identifier>-<short-run-id>` branch.
3. The agent's PTY output is fully captured in `agent_logs` and replayable via `lo logs <run-id>`.
4. The agent's heartbeat and status callbacks are authenticated and updates flow to the DB.
5. A run that exceeds its timeout is killed and recorded as `timed_out`.
6. A run that completes (callback `status: success`, `prMerged: true`) transitions the ticket to the team's mapped `done` state and removes its worktree. A `prMerged: false` success parks it in `inReview` and stores PR linkage on the run.
7. A `pull_request` merge webhook for a parked ticket transitions it to `done` — matched by stored `pr_number`/repo (or head branch fallback), with HMAC verified.
8. A failed run leaves the worktree intact for 7 days, applies the `lo:needs-human` label, and posts a Linear comment.
9. Concurrency cap of 2 is enforced — three queued runs at once result in 2 running + 1 queued.
10. State transitions resolve through the per-team `stateMap`; `lo linear bootstrap` produces a usable mapping from a real team's workflow states, and ticket creation is rejected for a team with no resolvable mapping.
11. Integration test suite passes against the in-memory DB and echo agent.
12. A manual smoke test against a real Linear sandbox and a real claude-code run completes end-to-end, including the GitHub merge webhook driving `done`.
