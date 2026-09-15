---
name: fix-ci
description: Drive a red PR back to green — find the current branch's PR, read each failing check's log, apply the smallest fix, push, re-watch. Bounded to ~3 iterations, then reports. Never merges. Use this when a PR's CI is failing (e.g. after /ship's CI watch or a Stop-hook ci-failing nag), or invoke it manually as /fix-ci.
argument-hint: [optional PR number, if not the current branch's PR]
allowed-tools: Bash(gh pr view *) Bash(gh pr checks *) Bash(gh run view *) Bash(gh run rerun *) Bash(python3 scripts/gh_fallback.py *) Bash(npm run lint*) Bash(npm run typecheck*) Bash(npm run format*) Bash(npm test*) Bash(npm run test:*) Bash(git add *) Bash(git commit *) Bash(git push *) Bash(git fetch *) Bash(git rebase *) Bash(git status *) Bash(git branch *) Bash(git rev-parse *) Bash(git log *) Bash(git diff *)
---

## Repo state (injected before you start)

- Branch: !`git rev-parse --abbrev-ref HEAD 2>/dev/null`
- Status: !`git status --short`
- PR: !`gh pr view --json number,title,mergeStateStatus -q '"#\(.number) \(.title) [\(.mergeStateStatus)]"' 2>/dev/null || echo "none for this branch"`

## Instructions

Fix the failing CI on this branch's PR, following TodoClaw's conventions exactly
(`CLAUDE.md`, "Branch Workflow").
`$ARGUMENTS` may name a PR number; otherwise resolve it from the current branch.

1. **Resolve the PR:** `gh pr view --json number,mergeStateStatus,url`. No PR for
   this branch → stop and say so (open one first — that's `/ship`'s job, not this
   skill's).

   **If `gh` fails with a TLS/x509 error, or `gh auth status` says "The token in
   GH_TOKEN is invalid" — the token is fine and this is not an auth problem.** Inside
   a dispatcher's sandbox every `gh` call dies on `tls: failed to verify certificate`
   because Go on darwin ignores `SSL_CERT_FILE` and asks the macOS platform verifier,
   which cannot reach a keychain there (TOD-116). Do not re-authenticate, do not
   hunt for a credential. Read PR state with
   `python3 scripts/gh_fallback.py pr-checks <n>` (no `--watch`; it exits non-zero
   while anything is pending or failed, so re-run it to poll) and comment with
   `pr-comment`. It reports `path: gh` or `path: rest` on every call, so a recovered
   `gh` cannot hide. **It has no merge operation and must never grow one.**
2. **Triage DIRTY first.** If `mergeStateStatus` is `DIRTY`, the PR has merge
   conflicts — **fixing code cannot fix a conflict**, and while conflicted the
   required CI never even runs (side checks like CodeQL can still look green).
   Hand off to the canonical rebase recipe before touching anything else:
   ```
   git fetch origin main && git rebase origin/main
   # resolve conflicts, then:
   git push --force-with-lease
   ```
   Then continue below — the force-push re-runs the required CI.

   **Inside a dispatcher's sandbox this recipe can fail on the environment, not on
   the conflict.** Worktrees share one `.git/config` outside any single worktree's
   write allowlist, so commands that write it — `git branch --set-upstream` is the
   one seen live, 2026-09-08 — come back `Operation not permitted`. That is a hard
   environment block: say which command was refused and escalate. Do not reach for
   a different spelling, and never `--force` (this repo forbids the bare flag;
   `--force-with-lease` above is the spelling that is allowed).

3. **Stop early on a failure no session can land.** If the fix belongs under
   `.github/workflows/`, stop here and report it. A dispatched session's push
   credential deliberately lacks GitHub's **Workflows** permission — a session that
   can rewrite CI could disable the guards supervising it — so **neither `git push`
   nor the REST contents API will accept it**; both were tried live on 2026-09-08 and
   both were refused. Recognise the refusal the first time and escalate: spending
   three iterations rediscovering a permission boundary costs real budget and ends
   exactly where it started. Say which file needs the change and that it needs either
   a human or the permission — that is a complete, correct answer.
4. **Read the failures.** `gh pr checks <n>` lists every check; for each failure,
   pull the run id from the check's link and read only what broke:
   `gh run view <run-id> --log-failed`. TodoClaw's required contexts are
   **Secret scan + forbidden paths**, **Lint**, **Typecheck** and **Test**; the same
   run also reports Deno, E2E (smoke), Migration guard, the three RLS/volume/DEFINER
   guards, Hook battery and the pipeline validators.

   **One red check is not yours to fix: "Hooks change guard".** It fails until a
   *human* adds the `hooks-change` label to a PR touching `.claude/hooks/**`,
   `.claude/settings.json` or `scripts/gh_fallback.py` — and the protected-label
   guard forbids a session applying it (TOD-111). No code change clears it. Say it is
   waiting on a person and leave it red; the Stop hook already knows not to nag about
   it, and it never spends a fix attempt.
5. **Flaky-shaped? Rerun ONCE, then investigate for real.** A failure that smells
   like infrastructure — runner lost communication, network timeout fetching
   deps, 429s, a job cancelled by the platform — gets exactly one
   `gh run rerun <run-id> --failed`. If it fails again, it is real: stop assuming
   flake and diagnose. Never rerun twice; repeated reruns are how real bugs get
   laundered into "flaky".
6. **Smallest fix that addresses the log's actual error.** Run the repo's
   relevant local checks before pushing. For TodoClaw that is `npm run lint`,
   `npm run typecheck`, `npm test`, and — separately — **`npm run format:check`**,
   which is NOT part of `npm run lint` and is the single commonest way a
   locally-green PR still goes red on CI. If you touched `.claude/hooks/**`, also
   `npm run test:hooks`; if you touched `supabase/functions/**`, the Deno job.
   Remember **local green is necessary, not sufficient**: CI catches things local
   runs miss (environment differences, format checks, jobs you don't run locally,
   the live-DB RLS job). The log, not the local run, is the source of truth.
7. **Commit and push:** write the message to a scratch file, `git commit -F`
   (conventional prefix, `Co-Authored-By:` line), push.
8. **Re-watch:** `gh pr checks <n> --watch` until every check reports.
9. **Bound the loop.** At most ~3 fix → push → watch iterations. Still red after
   that → STOP and report: which checks fail, what each log says, what you tried,
   and your best hypothesis — a human decision beats a fourth guess.

   **Report it out loud; do not just stop.** An unfinished job and a finished one
   must never look alike, and a session that goes
   quiet after three failed attempts renders "could not do it" exactly like "nothing
   to do". Say the PR is **not** green, name every check still red, and say whether
   you think a session can fix it at all. The Stop hook keeps the same count on the
   same branch and will demand this in writing once the budget is spent — arriving
   there having already said it is the point.
10. **Never merge.** Green means "ready for review", not "merge it" — `gh pr merge`
   is hook-blocked; merging is the human's action only. Report the PR URL and
   final CI state.
