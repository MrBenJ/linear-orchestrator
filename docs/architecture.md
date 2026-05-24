# Linear Orchestrator (LO) — Architecture Overview

This is a north-star reference for the system. It is **not** a per-phase implementable spec — those live in `docs/superpowers/specs/`. Read this first to understand the shape; read the phase spec to understand what we're actually building right now.

## Goal

Turn Linear tickets into completed, reviewed, merged pull requests with minimal hands-on driving. The user authors tickets via a Claude Code skill, LO orchestrates the rest: spawn an agent, observe its work, drive it through review, and (later) validate via a QA agent.

## Audience

Local-only, single user. LO runs on the user's machine. No multi-tenant, no auth, no cloud deployment. Optimizes for low ceremony — file-based config, `.env.local` secrets, one SQLite file.

## Why a Claude Code skill, not a web UI text input

The original instinct was a "type your prompt here" textarea in the LO web UI. Rejected because invoking `claude -p` (headless Claude Code) from a web UI consumes the Claude Pro/Max secondary tier (API-style metered usage on top of the subscription). Authoring tickets from inside an already-running Claude Code session — via a skill — avoids that cost.

**Consequence:** the LO web UI is **observational**, not authoring. It shows agent windows, run status, and Linear state. Ticket creation lives in the skill, which speaks to LO over HTTP.

Note that LO **does** spawn `claude-code -p` for autonomous work — that consumes secondary-tier credits. The trade is intentional: autonomous task execution justifies the cost, manual prompt typing does not.

## Subsystems

```
┌──────────────┐        ┌──────────────┐       ┌──────────────┐
│ Linear UI /  │ HTTPS  │  Tunnel      │ HTTPS │  LO (Next.js)│
│ writing skill│◀──────▶│ (ngrok/cf)   │◀─────▶│  localhost   │
└──────────────┘        └──────────────┘       └──────┬───────┘
                                                      │
                       ┌──────────────────────────────┼───────────────────────┐
                       │                              │                       │
                       ▼                              ▼                       ▼
              ┌─────────────────┐          ┌──────────────────┐    ┌────────────────────┐
              │ Linear REST API │          │ Agent worker     │    │ State store        │
              │ (tickets, state │          │ (node-pty,       │    │ (SQLite + Drizzle) │
              │  transitions)   │          │  worktrees)      │    │                    │
              └─────────────────┘          └────────┬─────────┘    └────────────────────┘
                                                    │
                                          ┌─────────┴──────────┐
                                          ▼                    ▼
                                  ┌──────────────┐    ┌──────────────┐
                                  │ Build agent  │    │ QA agent     │
                                  │ (CC/codex,   │    │ (post-merge, │
                                  │  /code-task) │    │  E2E tests)  │
                                  └──────────────┘    └──────────────┘
```

**1. LO core (Next.js)** — HTTP only. Hosts ticket-creation endpoint (from skill), Linear webhook receiver (from tunnel), and read APIs for the future UI. Thin route handlers, all real work delegated.

**2. Agent worker (separate Node process)** — owns the agent lifecycle. Polls SQLite for new runs, spawns `claude-code` or `codex` inside a fresh git worktree via `node-pty`, captures the PTY stream, enforces a configurable concurrency cap, handles timeouts and heartbeats. Restarting Next.js does not kill running agents.

**3. State store (SQLite + Drizzle)** — single file at `~/.linear-orchestrator/state.db`. Tables for tickets, runs, agent log chunks, config. Doubles as the IPC channel between Next.js and the worker.

**4. Linear client** — typed wrapper around Linear's API. CRUD tickets, transition state, post comments. One module, mockable for tests.

**5. Writing skill (separate sub-project)** — a Claude Code skill that walks the user through ticket fields (title, description, AC, prompt, harness, project), then POSTs a batch to `http://localhost:3000/api/tickets`. Returns Linear URLs.

**6. Post-completion flow** — driven *inside the spawned agent* by `/code-task`. The agent opens the PR, gets Aria's review, iterates, and merges. LO observes via Linear webhook state-transition events and the agent's status-callback. LO does **not** orchestrate review directly.

**7. QA flow (Phase 3)** — on merge-event webhook, spawn a second agent in a fresh worktree of `main`. Prompt: ticket AC + "validate this feature works, add E2E tests for it". Post results back to Linear as a comment.

**8. Web UI (Phase 4)** — observational only. Live agent terminals via `node-pty` → server-side capture → xterm.js. Linear status board. Run history.

## Cross-cutting

- **Secrets**: `.env.local` in the LO repo. `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`. Never committed.
- **Runtime config**: `~/.linear-orchestrator/config.json`. Project→repo mapping, concurrency cap, default timeouts. Editable via API later.
- **Webhook ingress**: ngrok or cloudflared tunnel. Tunnel URL is registered manually with Linear's webhook config. The tunnel must run alongside LO.
- **Observability**: every PTY stream is persisted as ordered chunks in SQLite (`agent_logs`) for replay. SSE endpoint serves them to the future UI. Until the UI exists, a `lo logs <run-id>` CLI is sufficient.
- **Failure modes**: any unhandled agent failure → run marked failed → LO applies a `lo:needs-human` **label** (not a workflow state) and posts the last 50 log lines as a comment. No auto-retry in any phase.
- **Linear state mapping**: Linear workflow states are custom per-team, so LO never hardcodes state names. It resolves semantic states (`inProgress`, `inReview`, `done`) to concrete state IDs per team via a config `stateMap` (auto-discovered, user-overridable). Orchestration signals use labels, not states. The user does not run Linear's GitHub integration, so LO drives all transitions itself and learns about merges from the agent's status callback (not from Linear).

## Phasing

| Phase | Scope | Spec |
|-------|-------|------|
| **1** | LO core + agent worker. End-to-end: ticket → webhook → agent runs in worktree → status callback → ticket transitions. | `docs/superpowers/specs/2026-05-22-phase-1-lo-core-and-agent-runner-design.md` |
| **2** | Writing skill. Author tickets from a Claude Code session, POST to LO. Refines /code-task footer template. | TBD |
| **3** | QA agent flow. Post-merge spawning, E2E test generation, AC validation. | TBD |
| **4** | Web UI. xterm.js agent terminals, Linear status board, run history. | TBD |

## Out of scope (any phase)

- Multi-user / auth
- Cloud deployment of LO itself
- Auto-retry on agent failure
- Cross-repo tickets (one ticket → one repo)
- Manual prompt entry from the web UI (see "Why a skill" above)

## Decision log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Authoring surface | Claude Code skill, not web UI textarea | Avoids secondary-tier cost of `claude -p` |
| Audience | Local-only, single user | No multi-tenant complexity |
| Repo mapping | Linear project → repo path (config) | One LO handles all projects; ticket inherits repo from project |
| State mapping | Linear team → `{inProgress, inReview, done}` state IDs (config, auto-discovered) | Linear states are custom per-team; never hardcode names |
| Exception signals | Labels (`lo:needs-human`), not workflow states | Labels are universal and API-creatable; states would require user to maintain matching workflow |
| Transition ownership | LO drives all transitions; merge learned from agent callback | User doesn't run Linear's GitHub integration |
| Concurrency | Configurable cap, isolated worktrees | Allows fan-out without collisions; cap protects the box |
| Webhook ingress | ngrok / cloudflared tunnel | Standard, well-supported, free tier |
| Runtime shape | Separate worker process | HTTP can restart without killing agents |
| Agent capture | `node-pty` (xterm.js-ready) | Future UI can render true terminal output; tmux deferred unless persistence across crashes is needed |
| DB | SQLite + Drizzle | Type-safe schema, codegen migrations, fits single-user scale |
| Prompt shape | User prompt + LO footer | User-authored content is primary; LO injects only operational context (branch, worktree, "use /code-task") |
| Success signal | Status callback API | Agent POSTs structured result; reliable, not guessing from exit code |
| Stuck-agent handling | Per-run timeout + heartbeat | Catches infinite-loop and silent-hang |
