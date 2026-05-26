# CI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions CI workflow that runs `typecheck` + `test` + `build` on every PR/push to `main`, then make it a required check via branch protection so red PRs can't merge and direct pushes to `main` are blocked.

**Architecture:** A single workflow file (`.github/workflows/ci.yml`) with one `verify` job. pnpm is installed via `pnpm/action-setup` (not corepack) to avoid the stale-signature-key bug; Node 22 matches local. Branch protection is enabled with a `gh api` call **after** the workflow's first run (so the `verify` check context exists) — this is a post-merge operator step, not part of the PR build.

**Tech Stack:** GitHub Actions, pnpm/action-setup@v4, actions/setup-node@v4.

**Spec:** `docs/superpowers/specs/2026-05-26-ci-workflow-design.md`

**Note on testing:** this is a CI/config change with no unit-testable surface. Per TDD config-exception rules, the build task commits without a unit test; the meaningful verification is running the exact CI command sequence locally (Task 1) and the workflow running green on its own introducing PR.

---

## File structure

```
.github/workflows/ci.yml   (new: the CI workflow)
```

The post-merge branch-protection step changes no files (a `gh api` settings call).

---

## Task 1: Add the CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
```

- [ ] **Step 2: Verify the workflow's command sequence passes locally**

Run exactly what CI will run:

```bash
pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build
```

Expected: install succeeds, typecheck clean, all tests pass, build prints "Compiled successfully". `next build` rewrites `tsconfig.json` locally — discard that so it isn't committed:

```bash
git checkout tsconfig.json 2>/dev/null || true
```

- [ ] **Step 3: Sanity-check the YAML is well-formed**

Run (Node is already available; this parses the file as YAML-ish by confirming it's non-empty and the key anchors exist — GitHub does the authoritative validation on push):

```bash
test -s .github/workflows/ci.yml && grep -q "^jobs:" .github/workflows/ci.yml && grep -q "pnpm build" .github/workflows/ci.yml && echo "workflow file OK"
```

Expected: prints `workflow file OK`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (typecheck, test, build)

Runs the full local verification on PRs/pushes to main. pnpm via
action-setup avoids the corepack signature bug; build is included to catch
errors tsc alone misses.

No test added — CI/config change; verified by running the workflow's command
sequence locally and by the workflow running on its own PR."
```

---

## Post-merge operator step (NOT a build-phase task)

> Run this **after** the workflow PR has merged and the `verify` check has run at least once on `main`/the PR — branch protection can only require a check context GitHub already knows about. This changes repo settings via the API, not files, so it is intentionally outside the `/code-task` build/PR flow.

- [ ] **Step A: Confirm the exact check context name**

```bash
gh api repos/MrBenJ/linear-orchestrator/commits/main/check-runs --jq '.check_runs[].name'
```

Expected: includes `verify` (the job name). If GitHub reports a different context string, use that string in Step B's `contexts` array instead of `verify`.

- [ ] **Step B: Enable branch protection requiring the check**

```bash
gh api -X PUT repos/MrBenJ/linear-orchestrator/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["verify"] },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
```

Expected: returns the protection object (HTTP 200). All four top-level keys are required by the API even when null.

- [ ] **Step C: Verify protection is active**

```bash
gh api repos/MrBenJ/linear-orchestrator/branches/main/protection --jq '{checks: .required_status_checks.contexts, admins: .enforce_admins.enabled}'
```

Expected: `{"checks":["verify"],"admins":true}`.

- [ ] **Step D: Confirm direct pushes to main are now rejected** (optional, non-destructive — expect failure)

```bash
git checkout main && git pull --ff-only origin main
echo "# protection probe" >> /tmp/lo-protection-probe.txt   # do NOT commit anything real
# Attempting an empty direct push is unnecessary; trust the API readback in Step C.
```

The Step C readback is sufficient proof; do not craft a real commit just to test rejection.

---

## Self-Review notes

**Spec coverage:**
- `ci.yml` runs install + typecheck + test + build on PR/push to `main` → Task 1 ✓
- pnpm via `action-setup` (avoids corepack bug), Node 22, pnpm store cache, `--frozen-lockfile`, concurrency cancel → Task 1 workflow body ✓
- `build` included to catch what `tsc` misses → Task 1 ✓
- Branch protection: `verify` required, `strict: false`, `enforce_admins: true`, no required reviews, `restrictions: null` → Post-merge Steps A–C ✓
- Sequencing (workflow first, protection after first run) → plan structure (Task 1 then Post-merge section) ✓

**Placeholder scan:** none — exact workflow YAML and exact `gh api` payloads are present.

**Consistency:** the required check context `verify` matches the job id/name `verify` in the workflow; Step A confirms it before Step B commits to it. Branch-protection JSON keys match the spec exactly (`strict:false`, `enforce_admins:true`, `required_pull_request_reviews:null`, `restrictions:null`).

**Note for the implementer:** if `/code-task` runs this plan, it executes only **Task 1** (the file) through the PR → review → merge flow. The Post-merge section is a manual operator step to run after that merge — do not attempt it during the build phase, because the `verify` check context will not exist until the workflow has run, and enabling `enforce_admins` mid-flow would interfere with the very merge in progress.
