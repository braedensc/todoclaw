# evals/ — prompt-evaluation harness

Evaluates TodoClaw's three AI surfaces against a scenario matrix, so prompt changes can be
measured instead of eyeballed:

| Surface | How it runs | Cost profile |
| --- | --- | --- |
| **BabyClaw chat** | The REAL `ai-chat` edge function over HTTP against local Supabase — full tool loop, confirm gates, DB effects | The expensive one (~35 tool defs per turn) |
| **Plan My Day** | `generatePlan()` in-process with fixture rows through the real `buildPlanRequest` | Cheap (~$0.03/scenario) |
| **Evening recap** | `generateRecap()` in-process with a fixture `RecapRequest` | Cheap |

Every scenario has **deterministic checks** (free — tool-call traces, DB end-state, format
contracts) and optionally an **LLM-judge rubric** (one API call, forced structured verdict).
Scenarios tagged `expectFailUntil` encode desired behavior a pending PR delivers — reported as
`⏳ expected-fail`, never as regressions.

This directory is **local-only tooling**: invisible to repo CI (no `tsc`/vitest/deno-CI globs
reach it) and to edge-function deploys. Type-checking is Deno's (`npm run eval:check`).

## Setup (one-time)

1. **Dedicated eval key** (never the production key): create an Anthropic API key for evals and
   export it in your shell profile by NAME:

   ```sh
   export EVAL_ANTHROPIC_API_KEY=<your dedicated eval key>   # in ~/.zshrc, never committed
   ```

2. **Local stack** (needed for chat scenarios only):

   ```sh
   supabase start
   # functions are served separately; give the runtime the SAME eval key:
   #   supabase/functions/.env.eval  (gitignored) containing: ANTHROPIC_API_KEY=<the eval key>
   supabase functions serve --env-file supabase/functions/.env.eval
   ```

   Plan/recap scenarios need neither — only the key.

## Running

```sh
npm run eval -- --list                 # what would run
npm run eval -- --kind plan            # one surface
npm run eval -- --filter pause         # by tag/id substring
npm run eval -- --no-judge             # deterministic checks only (cheapest)
npm run eval -- --mock                 # zero-API pipeline smoke (plan/recap only)
npm run eval -- --repeat 3             # flakiness estimate (models are stochastic)
```

**Prompt-experiment workflow (git-native):**

```sh
git checkout main            && npm run eval -- --save-baseline   # → results/baseline.json
git checkout my-prompt-tweak && npm run eval -- --baseline results/baseline.json
# report prints ↑FIXED / ↓REGRESSED / judge-score deltas per scenario
```

Cost: a full sweep is real money on the eval key (chat scenarios dominate). Iterate with
`--filter`/`--kind`/`--no-judge`; save full sweeps for decisions. The console prints a token/cost
estimate per run; reports land in `evals/results/` (gitignored — transcripts stay local).

## Layout

```
run.ts               CLI (flags above)
lib/
  types.ts           Scenario/check/report vocabulary
  env.ts             local-stack resolution + LOCAL-ONLY hard guard + eval-key lookup
  db.ts              provision/wipe/seed/snapshot scenario users (superuser, local only)
  chat-driver.ts     scripted SSE conversations (the app's own protocol + splitReply)
  checks.ts          deterministic combinators (compose these in scenarios)
  judge.ts           LLM-as-judge (forced emit_judgment) + render helpers
  report.ts          console summary, JSON persistence, baseline diff
  runner.ts          orchestration (chat sequential; plan/recap pooled)
  mock.ts            canned client for --mock
scenarios/           one file per family, one owner per file; registry in index.ts
```

## Authoring scenarios

Copy the patterns in `scenarios/chat/lifecycle-intent.ts`, `scenarios/plan/plan-rules.ts`,
`scenarios/recap/recap-core.ts`. Rules that matter:

- **Chat seeds are now-relative** (`dayOffsetISO(n)`, seed is a thunk) — the HTTP path can't pin
  the clock. **Plan fixtures pin the clock** to `PLAN_NOW` (`dayOffsetISO(n, tz, PLAN_NOW)`) —
  rot-free forever.
- Static scripts can't branch: use the **supersession trick** (a plain `say` turn clears any
  pending confirmation server-side) so a follow-up works whether or not a gate was raised.
- Prefer deterministic checks; use the rubric for judgment calls (action choice, tone, invention).
- Scenario ids are globally unique (`run.ts` asserts); tags drive `--filter`.
- Guardrail bounds that shape scenarios: 8 tool iterations + 2 memory writes per request,
  4000-char messages, 60-message transcript window.

## Safety rails

- `env.ts` refuses any non-local Supabase URL — eval runs wipe per-user rows and AI ledgers.
- The harness reads `EVAL_ANTHROPIC_API_KEY` only — it never falls back to the app's key.
- Never commit anything under `results/` or any env file; secretlint gates the repo.
