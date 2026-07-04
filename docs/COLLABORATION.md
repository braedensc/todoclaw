# Collaboration & Multi-Agent Workflow

How multiple people — and multiple Claude Code sessions — work on Todoclaw at the
same time without stepping on each other.

**Key mental model:** Claude Code does **not** coordinate across machines. Each
session is isolated and has no idea other humans or agents exist. Coordination is
**git + written context**, not a shared "Claude brain." The conflicts you'd hit
are the same two humans would hit — we just hit them faster, so the discipline
below matters more.

Most of this is **automatic** in this repo (see [Enforcement](#whats-automatic-enforcement)).
You rarely run these commands by hand — they're documented so the rules are legible.

---

## The one rule

**One task = one branch = one PR.** Never have two sessions editing the same
working directory at once. Keep branches small and short-lived: a branch that
lives 3 hours merges cleanly; one that lives 3 days collides.

---

## Branch naming

`<type>/<short-kebab-desc>` — `type` matches our conventional-commit prefixes:

| type | use for | example |
|---|---|---|
| `feat` | new feature | `feat/grid-drag` |
| `fix` | bug fix | `fix/cluster-overlap` |
| `chore` | tooling, deps, config | `chore/bump-vite` |
| `refactor` | no behavior change | `refactor/scoring-lib` |
| `docs` | docs only | `docs/collaboration` |

---

## Starting new work (the routine)

Claude does this automatically; here it is explicitly:

```bash
git checkout main
git pull --ff-only                       # start from latest (skip if offline / no remote yet)
git checkout -b feat/<short-desc>
# ...work...  commit on the branch
gh pr create --fill                      # open a PR; CI + review is the merge gate
```

You never merge your own work straight to `main` — that's what the PR + branch
protection is for.

---

## Running several Claudes at once — git worktrees

A **worktree** is a second checkout of the same repo in a different folder, on its
own branch. This is the current best practice for one person running multiple
parallel agents without them clobbering each other's files.

```bash
git worktree add ../todoclaw-grid feat/grid-drag      # new folder + new branch
git worktree add ../todoclaw-ai   feat/ai-panel
# Open a separate Claude Code session in each folder. Fully isolated:
# separate files, separate branch, separate context.

git worktree list                                     # see them all
git worktree remove ../todoclaw-grid                  # clean up when merged
```

Why worktrees beat just `git checkout` switching: switching branches mutates the
**one** working directory, so two sessions in the same folder fight. Worktrees
give each session its own folder. (Claude Code can also create/enter worktrees
for you — ask it to "work on X in a new worktree.")

**Caveat:** `node_modules/` and `.env.local` are per-folder (both gitignored),
even though every worktree shares the *same* local Supabase stack — one
`project_id` (`supabase/config.toml`), one Docker stack, one Postgres DB. Each
new worktree needs:

```bash
npm install
scripts/dev-worktree-login.sh <slug>   # e.g. the worktree/branch name
```

The script writes that worktree's `.env.local` from the running local stack and
creates a dedicated `<slug>@todoclaw.local` login — so parallel sessions each get
their own account instead of sharing (and clobbering) one. Requires `supabase
start` already running; see [SETUP.md](SETUP.md#local-supabase). (The pre-commit
secret scan is the exception to the per-folder rule — it falls back to the main
checkout's `secretlint` via the shared git dir, so commits from a worktree are
still scanned even before you `npm install` there.)

---

## Avoiding conflicts (the checklist)

- **Split work by feature folder, not by line.** Our `src/features/` layout (one
  folder per system: `grid/`, `list/`, `clustering/`, `ai/`, …) is built for
  this. Assign person A to `grid/`, person B to `ai/` — they almost never touch
  the same files. This is the single biggest conflict-avoider.
- **Small PRs, merged often.** Don't let a branch drift for days behind `main`.
- **Rebase on main before opening/updating a PR** if main moved:
  `git fetch origin && git rebase origin/main`.
- **`CLAUDE.md` + feature READMEs are shared coordination, not just docs.** Since
  each Claude session is isolated, written context is the *only* thing keeping
  separate sessions consistent (same scoring formulas, naming, conventions). Keep
  them current — update docs in the same PR as the code.
- **Committed hooks + CI mean every contributor's Claude plays by the same rules**
  (can't commit a secret, can't push to main) even if they never read this file.

### The one real danger zone: Supabase migrations

Two branches generating `supabase/migrations/` files in parallel will collide on
ordering/timestamps. **Serialize schema changes:**

1. Pull latest `main` *immediately* before `supabase migration new <name>` so your
   file sorts last.
2. Don't run two migration-producing branches at once without coordinating.
3. Get migration PRs reviewed and merged quickly — don't let them sit.

### Parallel-session protocol (learned the hard way, Stage 5 ∥ Stage 6)

Running several Claude sessions at once works well **if** the shared serialized
resources are handled explicitly. The Stage 5/6 parallel build collided three times
on ADR numbering and twice on doc-tail merges before these rules existed:

1. **Surface contracts in every kickoff prompt.** Each session gets an explicit
   "you own these paths; read-only everywhere else" list (feature folders, workflow
   files, specific docs). Code never collided under this rule — only shared docs did.
2. **Structurally eliminate shared counters.** ADRs are now one-file-per-decision
   with date+slug names (see `docs/ARCHITECTURE.md`) — no number to claim, no common
   tail to conflict. Prefer this shape for any future append-only log.
3. **The serialized-resources list** — these cannot be parallelized; ask Braeden to
   sequence: **DB migrations** (timestamp ordering), **golden E2E runs** (one shared
   test user + port 5174), **near-simultaneous merges to main** (deploy pipeline
   serializes itself, but doc-tail conflicts don't).
4. **Before claiming anything ordered** (a migration slot, a numbered artifact),
   check `origin/main` **and every open PR's diff** (`gh pr diff <n>`) — parallel
   sessions claim resources before they merge.
5. **The later-opened PR rebases.** Merge small and fast; the collision window is
   exactly the open-PR window.

---

## Task tracking — who works on what

Claude doesn't need a tracker; **humans do**, to claim a unit of work so two
people don't grab the same task. Scale the tool to the team:

| Scale | Tool |
|---|---|
| 2–3 people (this project) | **GitHub Issues + a Project board.** Free, next to the code; Claude can read/close issues via `gh` CLI. Start here. |
| Small team wanting polish | **Linear** (has an MCP server — Claude reads a ticket, implements, updates status). |
| Enterprise | **Jira / Azure DevOps**, usually via MCP for ticket context. |

**Claiming convention (GitHub Issues):** assign the issue to yourself and move it
to *In Progress* on the board **before** branching. Branch name references the
issue: `feat/142-grid-drag`. The agentic loop becomes: "Claude, implement #142" →
it reads the issue, branches, builds, opens the PR, you review.

---

## What's automatic (enforcement)

This repo enforces the workflow at four layers so you don't have to remember it —
mirroring the security model in `CLAUDE.md`:

1. **Claude Code PreToolUse hook** (`.claude/hooks/pre-tool-use.py`) — runs before
   every tool call, model **cannot** bypass it:
   - Blocks `Edit`/`Write`/`git commit` while on `main`/`master`, forcing a new
     task onto a branch before it starts. `CLAUDE.md` also tells Claude to
     branch *proactively* before it ever hits this block.
   - Blocks `git commit`/`git push` on a branch whose PR is already **merged**
     (checks `gh pr view <branch> --json state`) — a branch pushed after its PR
     merges is silently stranded, since GitHub stops syncing that PR's head and
     stops running CI on further pushes to it (learned the hard way 2026-07-03,
     PR #54). Fails open if `gh`/network is unavailable, so it never blocks on
     something it can't verify.
   - Blocks `gh pr merge` outright, including `--auto` — **merging is Braeden's
     action only.** Claude opens a PR and stops there. (`--disable-auto` is
     exempted, since it only undoes an auto-merge, never causes one.)
2. **Claude Code Stop hook** (`.claude/hooks/stop-pr-check.py`) — runs whenever
   Claude tries to end a turn, and blocks (with a reminder) when:
   - the current branch has pushed commits ahead of `main` with **no PR** at
     all yet, or
   - the branch's open PR has **failing CI** (`statusCheckRollup` shows a
     failing conclusion — this is what CLAUDE.md's "watch CI to green" rule
     means in practice).

   Dedups per `(branch, reason, commit sha)` so it can't loop even if the
   harness doesn't honor `stop_hook_active`, and fails open the same way as
   the PreToolUse hook above.
3. **Git pre-commit hook** (`.husky/pre-commit`) — blocks human/CLI commits on
   `main`. Bypassable with `--no-verify`, but…
4. **CI + branch protection** — the unbypassable gate. All changes land via PR
   with passing checks; no direct or force-push to `main`.

So in practice: just start working. If you (or Claude) try to edit on `main`, push
to an already-merged branch, or wrap up with no PR or red CI, you'll be told to
fix it first — that's the system doing its job, not an error. Merging itself stays
entirely yours: the PreToolUse hook only intercepts Claude's own tool calls, so it
blocks Claude from running `gh pr merge`, but never blocks you from merging via the
CLI or the GitHub UI.

---

## Enterprise / large-scale notes

For when this grows beyond a couple of people:

- **Claude Code GitHub Action / `@claude` mentions** — tag `@claude` on an issue
  or PR; it runs in CI to implement or review, decoupled from anyone's laptop.
  Work happens in the cloud, reviewed through the normal PR flow. Biggest "team"
  unlock.
- **Cloud / remote agent sessions** — long-running tasks run server-side, so you
  can fan out many agents without tying up local machines.
- **Review is the bottleneck and the quality gate.** When agents write more code,
  human + automated *review* is what protects quality: required reviews,
  `CODEOWNERS`, and automated passes (we have `/code-review`).
- **Centralized governance** — org-wide settings, permission policies, audit logs
  (we already append `.claude/audit.log`), shared MCP/hook configs so every
  developer's agent is governed identically.
- **Architecture decides how well this parallelizes.** Clear module boundaries
  (our `features/` split) let many agents/people work with minimal merge surface.
  Tangled shared files are where parallel agentic work breaks down.

---

## Quick reference

```bash
# Start a task
git checkout main && git pull --ff-only && git checkout -b feat/<desc>

# Run parallel agents (one worktree per task)
git worktree add ../todoclaw-<task> feat/<desc>
git worktree list
git worktree remove ../todoclaw-<task>

# Keep up to date / resolve drift
git fetch origin && git rebase origin/main

# Finish
gh pr create --fill
```
