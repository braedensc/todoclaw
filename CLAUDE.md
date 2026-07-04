# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## What This Is

Todoclaw is a ground-up rebuild of EisenClaw — an Eisenhower-matrix task planner — as a standalone, multi-tenant-ready web app. Tasks live on a free-canvas 2D grid (urgency × importance). The app is fully usable without AI; AI features are opt-in.

**Parity spec:** `planning/eisenclaw-export/docs/eisenclaw.md` is the acceptance spec — every feature is "done" only when it matches that document.
**Port reference:** `planning/EISENCLAW-LOGIC-TO-PORT.md` has verbatim constants, formulas, and thresholds extracted from the EisenClaw source with file:line citations. The code there is authoritative over the narrative spec where they conflict. Read the "Discrepancies & Open Questions" section first.

**Reference material** (all under `planning/`, which is gitignored — read it to port logic, never commit it):
- `eisenclaw-export/docs/eisenclaw.md` — parity spec (behavior)
- `EISENCLAW-LOGIC-TO-PORT.md` — port reference (exact constants/formulas, code-authoritative)
- `eisenclaw-export/scripts/planner.html` — original client (all UI + logic, 943 lines)
- `eisenclaw-export/scripts/planner-server.js` — original Node server (sync, backups, Plan My Day)
- `eisenclaw-export/data/user-schedule-braeden.json` — schedule config shape (→ `user_schedule` table)
- `eisenclaw-export/pics/Todopic{1-6}.jpeg` — screenshots of the original UI (visual parity reference; see `docs/STYLE.md` for what each shows)

**Run the original UI:** `npm run legacy-ui` boots the real EisenClaw app locally at
http://localhost:3333 (`?user=fan` = empty profile) — handy for eyeballing exact behavior while
porting. It runs the gitignored reference server via a temp `.cjs` copy (nothing under `planning/`
is modified). "Plan My Day" is stubbed with a deterministic local **mock** so its UX renders without
an Anthropic key. See `scripts/legacy-ui.ts` (+ `scripts/legacy-ui-mock-plan.cjs`).

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React 18 + TypeScript (strict) |
| Styling | Tailwind CSS (mobile-first) |
| Server state | TanStack Query — owns all tasks/habits: cache, loading, sync |
| UI state | React `useState`/`useContext` first; Zustand only if shared ephemeral state across distant components genuinely demands it |
| Backend | Supabase — PostgreSQL, Auth, RLS, Realtime, Edge Functions (Deno runtime) |
| Hosting | Vercel (frontend) + Supabase managed (backend) |
| AI | Anthropic API via Supabase Edge Functions — never called from the frontend |
| Testing | Vitest (unit/integration), React Testing Library (components), Playwright (E2E) |

**No Redux, ever.** Lightweight state only.

---

## Commands

> Real as of Stage 2 except `test:e2e` (Playwright, PR #5). Run `nvm use` (Node 22) first.

```bash
# Dev
npm run dev            # Vite dev server
supabase start         # Start local Supabase (Docker)

# Quality
npm run lint           # ESLint (flat config)
npm run format         # Prettier (write)
npm run format:check   # Prettier (check only — what CI runs)
npm run typecheck      # tsc -b (no emit)

# Test
npm test               # Vitest (unit + component, jsdom)
npm run test:e2e       # Playwright (added in Stage 2 PR #5)
npm run test:watch     # Vitest watch mode

# DB
supabase migration new <name>    # New migration
supabase db reset                # Reset local DB + re-run migrations

# Deploy (CI does this on merge to main — don't run manually against prod)
vercel                 # Preview deploy
```

---

## Architecture

```
src/
  features/           # One folder per system; each has its own README.md
    grid/             # Free-canvas 2D grid, drag/tap-to-place, quadrants
    list/             # Priority-ranked list view, sliders, inline edit
    clustering/       # Card clustering (seed-based, non-transitive)
    recurring/        # Recurring task logic and status computation
    habits/           # Daily habits + subtasks
    done/             # Done tab + permanent history log
    ai/               # Plan My Day + chat panel (opt-in, off by default)
  components/         # Shared UI primitives (no feature logic)
  hooks/              # Shared React hooks
  lib/                # Pure logic: scoring, dates, clustering math
  types/              # Shared TypeScript types (Zod schemas double as types)

supabase/
  migrations/         # Version-controlled schema; each file commented with intent + down path
  functions/          # Edge Functions (Deno); each has its own README.md

.claude/
  settings.json       # Claude Code hooks (committed, project-scoped)
  hooks/              # Hook scripts; see hooks/README.md
  audit.log           # Appended by PostToolUse hook (gitignored)

docs/                 # Human-facing cross-cutting docs (SETUP, SERVICES, ARCHITECTURE, STYLE)
planning/             # Reference only — gitignored, never published
```

**State ownership:** TanStack Query fetches/mutates tasks and habits via Supabase. Realtime subscriptions push updates; ignore echoed events from this client to avoid flicker. Drag state and cluster popups are local component state.

**Edge Functions run Deno, not Node.** Import style and testing differ. AI calls (Plan My Day, chat) happen server-side only — the Anthropic key is never in the frontend bundle.

---

## Conventions

**TypeScript:** strict mode. Zod schemas at boundaries (Edge Functions, forms); the inferred type IS the TS type — one source of truth.

**Files:** small and focused. Components do one thing. Logic lives in `lib/` or a feature's own module. Three similar files beat a premature abstraction.

**Naming:** kebab-case filenames, PascalCase components, camelCase everything else. Feature folders mirror the parity spec's feature names.

**Commits:** conventional commits — `feat:`, `fix:`, `chore:`, `refactor:`. No direct commits to `main`; all work via feature branches + PR. CI must pass before merge.

**PRs (all future work):** bodies must be scannable in under a minute — 2–3 plain sentences of what/why, one-line bullets for changes, one verification line. Everything deeper (rationale, edge cases, review writeups) goes in a `<details>` block, never the visible body. Target ≤ ~150 visible words.

**Docs (right-sized, post-launch):** fix any doc a change makes **stale** in the same PR — but don't expand docs proactively. A new ADR is warranted only for a decision that changes architecture, a security boundary, or an external service; routine features and fixes need none. (The bootstrap-era "ADR per PR" density was deliberate scaffolding and is retired — 2026-07-03.) Co-located READMEs for system-specific notes; `docs/` for cross-cutting concerns.

---

## Branch Workflow (do this automatically — never wait to be told)

Full workflow, worktrees, and team conventions: `docs/COLLABORATION.md`.

**At the start of any new feature, fix, or task — before your first `Edit`/`Write` — check the branch and create one if needed:**

```bash
git rev-parse --abbrev-ref HEAD          # what branch am I on?
# If on main (or the working tree has unrelated WIP), branch before editing:
git checkout main && git pull --ff-only  # start from latest (skip pull if offline/no remote)
git checkout -b <type>/<short-kebab-desc>
```

- **Branch name:** `<type>/<short-kebab-desc>`, type ∈ `feat | fix | chore | refactor | docs` — same set as commit prefixes. Examples: `feat/grid-drag`, `fix/cluster-overlap`, `docs/collaboration`. A new worktree session starts on an auto-generated `claude/<random-codename>` branch (e.g. `claude/cool-jones-ca5bef`) — rename it (`git branch -m <type>/<desc>`) before doing any work, don't let the codename land in a real PR.
- **One task = one branch = one PR.** Keep branches small and short-lived — they merge cleanly; long-lived branches collide.
- **The PreToolUse hook enforces this:** `Edit`/`Write`/`git commit` are *blocked* while on `main`, or on any branch whose name doesn't match `<type>/<short-kebab-desc>` (so an unrenamed `claude/<codename>` branch is blocked too). It also blocks `git commit`/`git push` on a branch whose PR is already merged (see below). If you see any of these blocks, it isn't a bug — branch fresh (or rename) and retry, do not try to work around it.
- **Don't switch branches mid-task** if files are uncommitted. Commit or stash first.
- **Migrations are serialized:** before adding a `supabase/migrations/` file, pull latest main so your timestamp/order is last. Never generate migrations on two branches in parallel without coordinating.
- **Open a PR when the task is done** (`gh pr create`); never merge your own work directly to `main`. **Merging is Braeden's action only — never run `gh pr merge` in any form, including `--auto`, and never enable auto-merge.** Opening the PR is the end of Claude's involvement. *(Also enforced by hooks: a Stop hook, `.claude/hooks/stop-pr-check.py`, blocks ending a turn on a pushed branch with no PR; a PreToolUse hook blocks `gh pr merge` outright. See docs/COLLABORATION.md's "What's automatic" section.)*
- **After opening or updating a PR, watch CI to green before considering the task done:** `gh pr checks <n> --watch`. If a check fails, read the failing job's log (`gh run view <run-id> --job <job-id> --log`), fix it, push, and re-watch — don't hand a red PR back and call it finished. Running local checks (`npm test`/`typecheck`/`lint`) first is necessary but not sufficient — CI catches things local runs miss (e.g. `format:check`, which isn't part of `npm run lint`), so treat the PR's actual CI status as the source of truth, not your local run. *(Also enforced by the same Stop hook — it blocks ending a turn while the branch's open PR has a failing check.)*
- **Before pushing a follow-up commit to an already-open PR, confirm it's still open** (`gh pr view <n> --json state`) — a PR can merge between your last check and your next push. A commit pushed to a merged PR's branch is silently orphaned: no CI runs, GitHub stops syncing the PR's head, and the content never reaches `main`. If it's merged, branch fresh off the new `main` instead. *(Also enforced deterministically by the PreToolUse hook — it blocks the commit/push outright once a branch's PR is MERGED, not just a written reminder.)*

---

## Hard Rules

These apply every session without exception:

1. **`planning/` is reference, never published.** It is gitignored. Never stage, commit, or push anything from it. Reading it to port logic is expected; copying its files is not.

2. **Secrets are never output.** Never echo, log, comment, or paste the value of any API key, token, password, or private key. Reference by name only (e.g. `process.env.ANTHROPIC_API_KEY`).

3. **No secret values in code.** If a secret value appears in any file about to be committed, block and flag it. Only `.env.example` (placeholder values) is committed.

4. **Supabase service role key is server-only.** It has admin DB access. It must never appear in any frontend file or client bundle.

5. **No direct or force push to `main`.** All changes via PR. CI is the unbypassable gate.

6. **The entire planner works without AI.** AI is additive, never required — a hard invariant. (MVP note, Stage 4: for the **invite-only** app on the owner's key, AI is available to every signed-in/trusted user; the original "opt-in, off by default" consent gate is **deferred** — see ADR-0014/0015. The owner key is bounded by server-side rate limits + a monthly budget kill-switch, not per-user consent. Re-adding a consent layer later is a thin change.)

---

## Security Model (three independent layers)

1. **Claude Code hooks** (`PreToolUse`) — guard Claude's real-time tool calls; the model cannot bypass these.
2. **Git pre-commit hooks** (Husky + secretlint) — guard commit contents locally (bypassable with `--no-verify`, but caught by CI).
3. **CI + branch protection** — the unbypassable gate on every PR. Same checks: secretlint, lint, types, tests.

At the database layer: **RLS on every table** (`user_id = auth.uid()`). No raw SQL — Supabase query builder only. Input validated with Zod at every boundary.

---

## Key Design Decisions

- **Grid coords:** `x` = urgency (0–1 left→right), `y` = importance (0–1 bottom→top — y is inverted from screen coords). Split at 0.5 for quadrants.
- **Priority score:** `x×0.45 + y×0.55 + (daysUntil(due) ≤ 2 ? 0.18 : 0)` — importance weighted above urgency.
- **Clustering:** seed-based, non-transitive. `CX=0.09, CY=0.07` overlap thresholds. A "bridge" card move cannot cascade-regroup distant clusters.
- **Collision resolution:** spiral outward from target, step `0.016`, clamp to `[0.04, 0.96]`. Only called on list-view slider commit — NOT on grid drag (overlap→cluster handles it there).
- **Daily reset:** computed against the user's stored timezone, not server UTC. The `user_schedule.timezone` column (hoisted out of `config` jsonb — see ADR-0007) is authoritative; `daily_state` is one row per `(user_id, local-date)`, so the reset is non-destructive (today = today's row).
- **Realtime conflict:** higher `_clientRev` (epoch ms) wins. Ignore Realtime events that originated from this client.
- **Mobile breakpoint:** `< 720px`. Tap-to-place replaces drag on mobile.
- **Drag/drop implementation:** spike @dnd-kit vs. raw pointer events before committing — the free-canvas model (continuous coords, custom clustering) cuts against @dnd-kit's sortable grain. Touch/mobile is the hard requirement.
- **History:** permanent log (newest-first). Restore is only available if the task is still in today's `done` map. Recurring tasks do NOT go to history — they reset `lastDoneAt`.

Full decision log with rationale: `docs/ARCHITECTURE.md`.
