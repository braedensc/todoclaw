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
npm run eval -- --list                 # what would run (respects --kind/--filter; runs nothing)
npm run eval -- --kind plan            # one surface: chat | plan | recap
npm run eval -- --filter pause         # substring match on scenario id OR any tag
npm run eval -- --no-judge             # deterministic checks only (cheapest)
npm run eval -- --mock                 # zero-API pipeline smoke (plan/recap only)
npm run eval -- --repeat 3             # flakiness estimate (models are stochastic)
npm run eval:prefixes                  # FREE: cached-prefix tokens vs each model's cache floor
```

**Running a subset.** `--kind` picks a surface; `--filter` narrows further by substring against
the scenario id and its tags. Every family file gives its scenarios a shared id prefix (`ongo-`
chat/ongoing-sessions, `safe-` chat/safety-injection, `pers-` chat/personas-complex, `pong-`
plan/plan-ongoing-sessions, `pedge-` plan/plan-edge-cases, `plan-` plan/plan-rules, …), so a
prefix filter runs exactly one family — e.g. a one-family shakedown before a paid sweep:

```sh
npm run eval -- --filter ongo- --list      # confirm what it selects, THEN
npm run eval -- --filter ongo- --no-judge  # run just that family, deterministic checks only
```

Both flags combine (`--kind chat --filter confirm`); always `--list` first before a paid run.
Other knobs: `--repeat N`, `--concurrency N` (plan/recap pool, default 3), `--judge-model <id>`
(defaults to the prod model — leave it there, see the gate below), `--no-fail-exit`.

**Prompt-experiment workflow (git-native):**

```sh
git checkout main            && npm run eval -- --save-baseline   # → results/baseline.json
git checkout my-prompt-tweak && npm run eval -- --baseline results/baseline.json
# report prints ↑FIXED / ↓REGRESSED / judge-score deltas per scenario
```

Cost: a full sweep is real money on the eval key (chat scenarios dominate). Iterate with
`--filter`/`--kind`/`--no-judge`; save full sweeps for decisions. The console prints a token/cost
estimate per run; reports land in `evals/results/` (gitignored — transcripts stay local).
Prompt caching (PR 3) cuts sweep cost: plan/recap system prompts carry a 5-min-TTL cache
breakpoint, so back-to-back scenarios read the cached prefix (~0.1× input rate) instead of
re-billing it — the report's estimate includes the cache write (1.25×) and read (0.1×) terms.
Whether a given MODEL gets any cache benefit depends on its floor — `npm run eval:prefixes`
(free, key only, no local stack) prints each surface's real prefix size against each allowlisted
model's minimum cacheable length.

## Model-switch gate

**No production model flip without a before/after eval run** (Braeden's gate, 2026-08-20).

Use `--model <id>` — do NOT hand-edit `app_config` and then run: `prepareStack` pins the model
columns at the start of every run, so a hand-set value is overwritten and the sweep silently
measures the PROD model while the report claims the candidate. `--model` is the only correct way,
and it drives both paths (chat via `app_config`, plan/recap passed straight to the builders).
It is validated against the app's own allowlists during `--list`, so a typo costs nothing.

The judge deliberately does NOT follow `--model`: a candidate grading itself makes the two runs
incomparable. Leave `--judge-model` alone.

```sh
# 1. Shakedown — flush harness rot before spending (free-ish, one family, no judge)
npm run eval:check
npm run eval -- --filter ongo- --no-judge

# 2. Baseline on the PROD model
npm run eval -- --kind chat --save-baseline        # → results/baseline.json

# 3. Candidate sweep
npm run eval -- --kind chat --model claude-haiku-4-5 --baseline results/baseline.json

# 4. Targeted repeats — ONLY on what flaked or regressed
npm run eval -- --filter <scenario-id> --model claude-haiku-4-5 --repeat 3
```

**Reading the diff.** `↓ REGRESSED` is a verdict flip and is disqualifying. `⚠ QUALITY` marks a
scenario that still passed but dropped on **correctness or faithfulness** — the two axes that mean
"did the right thing". Those are per-axis on purpose: an earlier summed delta cancelled a
correctness collapse against a tone gain and printed nothing at all. The tail line counts them.

**Sensitive families** — read these scenarios' diffs individually before flipping: injection
resistance (`safe-`), the destructive confirm gates, and the 8-step personas (`pers-`).

- A `plan_model` switch mirrors the same protocol with `--kind plan` (and `--kind recap`, which
  rides the plan knob).
- **Run batches back-to-back**: cached prefixes carry a 5-minute TTL, so a longer pause re-bills
  the full prefix at the 1.25× write rate.
- Check `npm run eval:prefixes` first — a prefix below the candidate's floor (Haiku's is 4096
  tokens) gets no caching at all, which changes the cost maths.

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
tools/
  count-prefixes.ts  FREE prefix-vs-cache-floor measurement (npm run eval:prefixes)
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

**Rubric rules (recalibrated 2026-08-22 after the first paid runs).** The suite's job is
regression data — model switches, parameter tweaks, prompt experiments — so a fail must mean
"the app got worse", never "the judge preferred a different style". First paid run: ~half the
failures were rubrics enforcing opinions no prompt ever set. Hence:

1. **A check (deterministic OR rubric) may only fail what the shipped prompt mandates or bans.**
   If the prompt says "optionally" / "may" / "1–2", a check cannot require or forbid it. If you
   want to assert it, change the prompt first (an owner behavior decision), then the check.
   Corollary (owner ruling 2026-08-22): the QUANTITY of style — warmth, emoji, "flourishes",
   sign-off niceties — is never judged, even where the prompt steers it ("at most one small
   flourish" is style steering, not a contract). The eval judges content: right action, right
   items, faithful data, banned tones. Word caps stay deterministic where decided.
   Second corollary: playful persona color (BabyClaw's dog-flavored asides) is not "invention" —
   the invention failure is about factual claims on the user's data, and the prompts explicitly
   welcome light dog flavor. The judge contract carries this scoping; don't re-add broad
   "no invented details" phrasing to rubrics that would collide with it.
2. **Rubrics are FAIL-conditions-only.** Write `FAIL if: …` lists, not "the ideal response…"
   narrations — the judge defaults to pass and only fails on a named condition, so anything
   phrased as an ideal is dead text that misleads the next author. Genuine judgment calls
   (right action, faithful data, banned tone) are exactly what belongs there.
3. **No double jeopardy.** A dimension with a deterministic check (length, signoff, format,
   forbidden strings) must not also appear in the rubric — the judge is instructed to ignore
   those dimensions, and a rubric mention just invites a contradictory verdict.
4. **Don't defang.** The rubric is the ONLY detector for semantic failures: wrong task chosen,
   invented data, guilt/scolding, injection compliance, praise-for-bookkeeping. Every scenario
   that keeps a rubric must keep its real failure modes; if nothing is left after rule 1-3, drop
   the rubric entirely rather than padding it (deterministic-only scenarios are fine and free).
5. **The scores are telemetry, not the gate.** Verdicts drive pass/fail; the 1-5 axis scores
   exist for run-over-run comparison (`--baseline` deltas) when swapping models or parameters —
   that comparison only works if the judge model stays fixed across both runs.

## Safety rails

- `env.ts` refuses any non-local Supabase URL — eval runs wipe per-user rows and AI ledgers.
- The harness reads `EVAL_ANTHROPIC_API_KEY` only — it never falls back to the app's key.
- Never commit anything under `results/` or any env file; secretlint gates the repo.
