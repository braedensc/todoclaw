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

> Stubs — filled in as tooling is installed in each stage.

```bash
# Dev
npm run dev            # Vite dev server
supabase start         # Start local Supabase (Docker)

# Quality
npm run lint           # ESLint
npm run format         # Prettier
npm run typecheck      # tsc --noEmit

# Test
npm test               # Vitest (unit + integration)
npm run test:e2e       # Playwright
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

**Docs:** updated in the same PR as the code they describe — never "later." Co-located READMEs (features, Edge Functions, hooks) for system-specific notes; `docs/` for cross-cutting concerns.

---

## Hard Rules

These apply every session without exception:

1. **`planning/` is reference, never published.** It is gitignored. Never stage, commit, or push anything from it. Reading it to port logic is expected; copying its files is not.

2. **Secrets are never output.** Never echo, log, comment, or paste the value of any API key, token, password, or private key. Reference by name only (e.g. `process.env.ANTHROPIC_API_KEY`).

3. **No secret values in code.** If a secret value appears in any file about to be committed, block and flag it. Only `.env.example` (placeholder values) is committed.

4. **Supabase service role key is server-only.** It has admin DB access. It must never appear in any frontend file or client bundle.

5. **No direct or force push to `main`.** All changes via PR. CI is the unbypassable gate.

6. **AI is opt-in, off by default.** The entire planner works without it. AI features require explicit user enablement with a clear privacy notice.

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
- **Daily reset:** computed against the user's stored timezone, not server UTC. `user_schedule.config.timezone` is authoritative.
- **Realtime conflict:** higher `_clientRev` (epoch ms) wins. Ignore Realtime events that originated from this client.
- **Mobile breakpoint:** `< 720px`. Tap-to-place replaces drag on mobile.
- **Drag/drop implementation:** spike @dnd-kit vs. raw pointer events before committing — the free-canvas model (continuous coords, custom clustering) cuts against @dnd-kit's sortable grain. Touch/mobile is the hard requirement.
- **History:** permanent log (newest-first). Restore is only available if the task is still in today's `done` map. Recurring tasks do NOT go to history — they reset `lastDoneAt`.

Full decision log with rationale: `docs/ARCHITECTURE.md`.
