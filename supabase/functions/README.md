# Edge Functions (Deno)

Server-side AI for Todoclaw. **The Anthropic key never leaves the server** — all model calls
run here, never in the frontend bundle (CLAUDE.md Hard Rule; ADR-0015). Deno 2 runtime
(`supabase/config.toml` → `[edge_runtime]`).

## Layout

```
_shared/        # shared modules (imported by each function via ../_shared/*.ts)
  cors.ts        # origin allow-list (ALLOWED_ORIGIN), preflight — never '*'
  auth.ts        # caller-JWT-scoped Supabase client (RLS applies; no service-role here)
  anthropic.ts   # Anthropic SDK client factory + MODEL/MAX_TOKENS (owner key from env)
  guardrails.ts  # per-user rate limits + global budget kill-switch + cost math
  weather.ts     # wttr.in summary, cached ~30min via weather_cache (DEFINER get/put)
  plan-prompt.ts # Plan My Day prompt builder + emit_plan tool (structured output)
  placement.ts   # due-date → x/y/staged auto-placement table (Discrepancy #5)
  chat-tools.ts  # chat tools: defs + Zod input + executors + the destructive set
  chat-prompt.ts # chat system prompt (trust-boundary framing) + grid seeding
  sse.ts         # Server-Sent Events encoder for the streaming chat
  dates.ts       # localDateInTZ port (for complete_task's user-local date)
  *.test.ts      # deno unit tests for the pure logic (cors, cost, prompt, placement, tools, dates)
ai-status/       # PR2 proof endpoint: returns the caller's budget/rate-limit state (no model call)
plan-my-day/     # PR3: schedule + weather-aware daily plan (forced emit_plan tool → structured JSON)
ai-chat/         # PR4: streaming chat with user-scoped tools; confirm before destructive ops (ADR-0017)
```

## Guardrails (protect the owner's key — ADR-0015)

Backed by `supabase/migrations/20260624010000_ai_usage_and_budget.sql`:

- **Per-user rate limits** — `ai_usage` (append-only) + `ai_usage_check_and_record` (SECURITY
  INVOKER; counts the caller's trailing-hour/day rows, raises when over). Balanced tier: chat
  30/hour + 100/day, plan_my_day 10/day.
- **Global monthly budget kill-switch** — `ai_budget_ledger` (one row per `YYYY-MM`, **no
  grants/policies** → unreachable by app roles) read/written only by `ai_budget_check` /
  `ai_budget_add` (SECURITY DEFINER). $20/month cap; when tripped, every AI endpoint refuses.
  This keeps the **service-role key out of the functions entirely** — the ledger is reached via
  these RPCs under the caller's JWT, never an admin client.

## Local dev

```bash
supabase start                 # local stack (Docker)
supabase functions serve       # serve all functions, hot-reload (per_worker)
# functions live at http://127.0.0.1:54321/functions/v1/<name>
```

Secrets (production; only the human can set — the hook blocks `.env*` + the key value):

```bash
supabase secrets set ANTHROPIC_API_KEY=...        # owner key (required for PR3/PR4)
supabase secrets set ALLOWED_ORIGIN=https://<app> # prod origin for CORS (dev defaults to localhost:5173)
```

`SUPABASE_URL` / `SUPABASE_ANON_KEY` are auto-injected by the platform — no secret to set.

## Testing

- **Pure logic** → `deno test --allow-env --no-check _shared/` (cors origin-lock, cost math).
- **DB guardrails** → applied by `supabase db reset`; behaviour proven with a psql proof
  (rate-limit raise, kill-switch, ledger invisibility, anon block).
- **Function end-to-end** → `supabase functions serve` + curl (auth/401, status body).
- **CORS caveat:** local `supabase functions serve` injects a permissive
  `Access-Control-Allow-Origin: *` at the gateway, so the origin-lock can't be observed via
  local curl. The lock is verified by the `cors.ts` deno unit test (the function's own headers
  are what apply in production); re-verify against the deployed function in Stage 6.

## Toolchain note

`supabase/functions/**` is **excluded from the frontend ESLint** (different runtime/globals +
`npm:`/`jsr:` specifiers) and from `tsc -b` (`src`-only). It is checked with Deno
(`deno test` / `deno check`). Prettier still formats it (one repo formatter). CI auto-deploy of
functions is deferred to Stage 6; until then deploy is manual (`supabase functions deploy <name>`).
