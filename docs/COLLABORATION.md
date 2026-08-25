# Collaboration & Multi-Agent Workflow

How multiple people — and multiple Claude Code sessions — work on TodoClaw at the
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

When the work has a Linear ticket, put its id in the branch —
`<type>/tod-nn-<short-desc>`, e.g. `feat/tod-12-admin-knobs`. See
[Task tracking](#task-tracking--who-works-on-what) for why that id earns its place.

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

**Where they land:** the `git worktree add` lines above put them *beside* the repo
(`../todoclaw-grid`); Claude Code's own worktree tool puts them *inside* it, under
`.claude/worktrees/<name>/`. Both work, but the nested ones are a second full copy
of the repo sitting in the tree that `npm run lint` walks — so `eslint.config.js`
ignores `.claude/worktrees/` (and `.prettierignore` matches it). Without that the
extra `tsconfig.json` roots make typescript-eslint's `tsconfigRootDir` inference
ambiguous and *every* file in the repo becomes a fatal parse error, which reads as
thousands of lint failures that have nothing to do with your change. If you add a
tool that walks the repo tree, exclude that directory in it too.

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
sessions don't grab the same task. This project uses **Linear**
(`linear.app/todoclaw`, team `TOD`), reachable from a session over its MCP server —
so Claude reads the ticket itself rather than being told what it says.

The board *is* the roadmap: one project per phase, plus the cross-cutting Admin
control plane and Launch-readiness epics and a standing **Maintenance & polish**
queue. Sizing lives in Linear's native `estimate` field (2/3/4 = S/M/L) and the
work track in a `track:*` label.

**Status is the claim.** With one maintainer there's no assignee ceremony — moving
a ticket out of `Backlog` is what claims it:

| Status | Meaning | Who sets it |
|---|---|---|
| `Backlog` | Exists, not scheduled | the default |
| `Todo` | Claimed — this is next | Braeden |
| `In Progress` | A branch or draft PR exists | GitHub integration † |
| `In Review` | PR open, Braeden's court | GitHub integration † |
| `Done` | Merged | GitHub integration † |

† Once Linear's GitHub integration is connected (workspace Settings → Integrations),
those three transitions fire off branch and PR events and nobody sets them by hand —
git becomes the thing that writes board state, which is the only version of this that
doesn't drift. Until then they are manual, and the board is only as current as the
last person who remembered.

**Claiming convention:** move the ticket to *Todo*, then start a session with
"implement TOD-nn". The session reads the ticket over MCP, branches
`<type>/tod-nn-<short-desc>` (e.g. `feat/tod-12-admin-knobs`), builds, and opens the
PR; you review and merge. That branch form is doing two jobs at once — it satisfies
the PreToolUse branch-name guard *and* is what Linear's GitHub integration
autolinks on, which is what moves the ticket's status without anyone touching the
board.

**CI-green is deliberately not a board state.** The Stop hook blocks ending a turn
on a red PR and branch protection blocks merging one, so "merged" already implies
"green" — modelling it in Linear too would only add a second thing to keep in sync.

Two things worth knowing when a session reads a ticket:

- A description that opens with a **Source note (board audit 2026-08-22)** block has
  been checked against `main`; one without it has not.
- Cited line numbers drift as the code moves. Trust file and symbol names over line
  numbers, and trust the repo over the ticket — a ticket is a plan, not a spec.

**Maintenance work is a queue, not a changelog.** File a ticket only for something
you found and consciously deferred; a bug you fix in the same session needs no
ticket, because git history already records it. Don't backfill tickets for merged
work.

---

## Binding a session to a ticket — local dispatch

The claiming convention above ("start a session with *implement TOD-nn*") still
works and needs nothing set up. This section is the other path: the delivery
pipeline's `/work` skill, which refuses to run on trust.

Since #392 this repo has a committed `delivery.json`, so the pipeline counts as
**configured**. Per `docs/PIPELINE-CONTRACT.md` §2 that makes a `ticket`-mode
session with no **pin** the *Broken* state, and broken fails closed — `/work`
stops before doing anything. The pin is the one piece of authority a session
cannot write for itself: the dispatcher places it **outside every worktree**,
before the session starts, and it carries the ticket's acceptance criteria and
scope fence. Everything a session *can* write — the branch name, the PR body — is
reporting, never authority.

`scripts/pipeline_dispatch_local.py` is the human-run dispatcher (kit Tier 0). It
writes exactly the pin the CI dispatcher would, so a local `/work` run is properly
bound without standing up the whole GitHub Actions dispatch surface.

```bash
python3 scripts/pipeline_dispatch_local.py TOD-90     # bind this worktree
python3 scripts/pipeline_dispatch_local.py --show     # what is bound here?
python3 scripts/pipeline_dispatch_local.py --release  # tear the pin down
```

It reads the ticket from Linear using the key in `$LINEAR_API_KEY` (never passed
as a flag), or offline from `--ticket-file <issue.json>`. `--dry-run` prints the
pin without writing it. The pin expires in hours, so a stale binding stops
mattering on its own; `--release` when the session ends regardless — **you are the
dispatcher here**, so teardown is yours too.

Three properties are load-bearing, and each one refuses rather than guesses:

- **It is a human tool. An agent must never run it for itself.** A session that can
  place its own binding can retarget itself at another ticket, widen its own scope
  fence, or grant itself a budget nobody approved — the exact attack §3 exists to
  prevent. It detects a Claude Code environment and refuses, with no override flag.
  That check is *tamper-evident, not tamper-proof*: it names what it saw so a
  bypass is visible.
- **It will not invent acceptance criteria.** A missing or empty
  `## Acceptance criteria` section exits non-zero and writes nothing. The criteria
  are the grader for the run, and criteria written by the thing being graded are
  not a definition of done — an empty list is a Definition-of-Ready failure for a
  person to fix on the ticket. `python3 scripts/check_ticket_dor.py <ticket.json>`
  reports what else is missing.
- **It reads `delivery.json` from the committed copy on the default branch**, never
  the working tree. `dispatch.pinsRoot` decides where "the only authority" is read
  from, and a config a session can rewrite is a pin a session can plant.

`scripts/check_ticket_dor.py` and `docs/TICKET-TEMPLATE.md` come with it: the
dispatcher imports the gate's own parser instead of reading descriptions its own
way, so the criteria that land on a pin are the ones a human actually wrote. All
three files, like `schemas/` and `docs/PIPELINE-CONTRACT.md`, are vendored
byte-identical from claude-project-kit — fix them upstream, then re-sync.

> **Not yet wired into CI:** `npm run test:local-dispatch` (56 cases) passes 50 here
> and fails 6, all in one drift check that asserts this script, a pin-aware
> `.claude/hooks/pre-tool-use.py` and `templates/workflows/pipeline-dispatch.yml`
> still derive the pin key identically. This repo has neither of those two
> counterparties yet, so those cases fail on absent files, not on real drift. The
> parser half (`npm run test:dor`, 45 cases) *is* in CI. Turn the dispatcher step on
> once the pin-aware hook lands.

---

## What's automatic (enforcement)

This repo enforces the workflow at four layers so you don't have to remember it —
mirroring the security model in `CLAUDE.md`:

1. **Claude Code PreToolUse hook** (`.claude/hooks/pre-tool-use.py`) — runs before
   every tool call, model **cannot** bypass it:
   - Blocks `Edit`/`Write`/`git commit` while on `main`/`master`, forcing a new
     task onto a branch before it starts. `CLAUDE.md` also tells Claude to
     branch *proactively* before it ever hits this block.
   - Blocks `Edit`/`Write`/`git commit` on any branch whose name doesn't match
     `<type>/<short-kebab-desc>` — catches a new worktree session that starts
     work without renaming its auto-generated `claude/<random-codename>` branch
     (this landed unrenamed in a real PR, #55, before this guard existed).
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

# Bind this worktree to a ticket for /work, then tear it down (human-run)
python3 scripts/pipeline_dispatch_local.py TOD-nn
python3 scripts/pipeline_dispatch_local.py --release

# Finish
gh pr create --fill
```
