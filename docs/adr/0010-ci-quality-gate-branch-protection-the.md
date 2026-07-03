# ADR-0010 — CI quality gate + branch protection (the merge-then-require ordering)

**Date:** 2026-06-23 · **Stage:** 2 (PR #4)

`ci.yml` gains three jobs beside the Stage 1 secret/path gate — **Lint** (ESLint + Prettier
check), **Typecheck** (`tsc -b`), **Test** (Vitest) — all Node 22 / `npm ci`, running in
parallel on every push to `main` and every PR. This makes lint/types/tests the **unbypassable**
gate (layer 3); the pre-commit hook (layer 2) is the fast local mirror.

- **A job's `name:` IS its required-status-check context.** So the contexts are exactly
  `Lint` / `Typecheck` / `Test` / `Secret scan + forbidden paths`.
- **Merge the jobs, THEN require them — never in one motion.** GitHub will accept a required
  context that has never reported, but the instant you do, **every open PR is blocked**
  ("Expected — waiting for status to report") until that exact context reports on its head SHA.
  With the Stage 2 PRs stacked and open, flipping protection before the jobs exist on those
  branches would wedge them all. So: this PR only *adds* the jobs; the branch-protection update
  (`POST …/required_status_checks/contexts`, which adds without dropping the existing context) is
  a separate admin step run **after this PR merges to `main`** and the jobs have reported there.
  Command + rationale live in SERVICES.md.
- **`strict: true` tradeoff.** Required "branch up to date" means more rebasing now that there
  are four checks; acceptable for a 1–2 person repo, revisit if it becomes friction.
- **E2E stays out of this gate** — the Playwright smoke job (PR #5) lands non-required first so
  flakiness can't wedge `main`; promote it to required only once proven stable.
