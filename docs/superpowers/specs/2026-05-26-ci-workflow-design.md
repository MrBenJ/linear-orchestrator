# CI Workflow — Design Spec

**Status:** Approved (design)
**Next:** Implementation plan via `superpowers:writing-plans`

## Goal

Protect the open-source repo with a GitHub Actions CI workflow that runs the full local verification (`typecheck` + `test` + `build`) on every PR and push to `main`, and make that check a required gate so red PRs cannot merge. This closes the gap Aria caught repeatedly: `pnpm typecheck` misses errors that only `next build` surfaces, and the repo has had no automated protection at all.

## Why now

Across PRs #1–#3 Aria flagged "no checks reported on this branch," and twice caught issues (`NODE_ENV` ProcessEnv type error) that `tsc --noEmit` passed but `next build` failed on. CI shifts those catches left and removes the reliance on Aria as the only gate.

## Workflow

`.github/workflows/ci.yml` — single job `verify`, triggered on `pull_request` → `main` and `push` → `main`:

1. `actions/checkout@v4`
2. `pnpm/action-setup@v4` with `version: 11` — installs pnpm directly rather than via corepack, sidestepping the corepack stale-signature-key bug we hit locally (`Cannot find matching keyid`).
3. `actions/setup-node@v4` with `node-version: 22`, `cache: pnpm` — matches the local Node version; caches the pnpm store (requires pnpm to be installed first, hence action order).
4. `pnpm install --frozen-lockfile` — fails if the committed lockfile is stale; runs the root `postinstall` (node-pty `spawn-helper` perms fix) and the allowlisted native builds (`better-sqlite3`, `esbuild`, `node-pty`).
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm build`

A `concurrency` group keyed on `github.ref` with `cancel-in-progress: true` cancels superseded runs on the same branch.

### Rationale for choices

- **pnpm via `action-setup`, not corepack:** the runner's bundled corepack version is unpredictable; `action-setup` installs a pinned pnpm and avoids the signature-verification failure.
- **`build` in CI:** `next build`'s type-check is stricter than standalone `tsc` (it requires `NODE_ENV` on `ProcessEnv` literals and only type-checks files in the build graph differently). Running it in CI catches what `typecheck` alone does not.
- **Single sequential job:** YAGNI — no matrix, no parallel jobs; the suite is fast and the project targets a single Node version.

## Branch protection on `main`

Enabled via `gh api` (PUT `/repos/MrBenJ/linear-orchestrator/branches/main/protection`) **after** the workflow's first run, so GitHub knows the `verify` check context exists:

- `required_status_checks`: `{ strict: false, contexts: ["verify"] }` — the `verify` check must pass to merge; `strict: false` avoids forcing branches up-to-date before merge (no constant rebasing on a solo repo).
- `enforce_admins: true` — blocks direct pushes to `main` for everyone, including the maintainer. All changes go through a green PR.
- `required_pull_request_reviews: null` — no GitHub-required reviews. Aria is not a GitHub reviewer; review approval is gated manually in `/code-task` via her review state. Requiring GitHub reviews here would deadlock merges.
- `restrictions: null`.

`/code-task`'s squash-merge continues to work: it merges via the API once the `verify` check is green and Aria has approved. Direct `git push origin main` becomes blocked for everyone — the intended outcome.

## Sequencing (chicken-and-egg)

1. Land `ci.yml` via a normal PR. The workflow runs on that PR (a workflow added in a PR executes from the PR head), proving it green before merge.
2. Merge the PR.
3. Enable branch protection referencing the now-known `verify` check (a one-time post-merge `gh api` call — not part of any PR diff).

## Out of scope

- Lint (no `lint` script exists in the project).
- Deploy / release automation.
- Matrix testing across Node versions or OSes.
- Required GitHub PR reviews.

## Acceptance criteria

1. `ci.yml` runs on PRs to `main` and pushes to `main`, executing install + typecheck + test + build.
2. The workflow is green on its own introducing PR.
3. After merge, `main` requires the `verify` check to pass before any PR merges, and direct pushes to `main` are rejected (`enforce_admins: true`).
4. A PR that breaks `typecheck`, `test`, or `build` shows a failing `verify` check and cannot be merged.
