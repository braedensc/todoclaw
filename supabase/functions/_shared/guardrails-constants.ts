// guardrails-constants.ts — the primitive guardrail constants + the Feature type, in their own
// import-free module so BOTH guardrails.ts (enforcement) and guardrails-config.ts (the runtime
// app_config loader) can import them without a circular import (a cycle with a top-level cross-module
// const read would TDZ-throw under Deno's native ESM). These are the DEFAULT / FALLBACK values; the
// live values come from app_config via loadConfig (guardrails-config.ts). All of these are
// re-exported from guardrails.ts, so existing `from './guardrails.ts'` imports are unaffected.

export type Feature = 'chat' | 'plan_my_day'

// Balanced tier (chosen 2026-06-24). plan_my_day's hour==day makes it an effective daily cap.
// These are the DEFAULTS; the owner can tune the live limits via app_config (Admin panel).
export const LIMITS: Record<Feature, { hour: number; day: number }> = {
  chat: { hour: 30, day: 100 },
  plan_my_day: { hour: 10, day: 10 },
}

// $20.00/month, in micro-dollars (millionths of a USD). The FALLBACK global kill-switch cap —
// applied only when app_config can't be read. The LIVE ceiling was re-seeded to $60 (migration
// 20260820210850: it becomes the manual ceiling of the scaled cap); the fallback deliberately
// stays at the old $20 so a config outage degrades to the tighter, safer bound.
export const BUDGET_CAP_MICROS = 20_000_000

// Per-user monthly sub-cap, $10.00 (half the global pool) — Issue 3 of the 2026-07-06 audit. The $20
// budget is a single GLOBAL pool, so one heavy account could drain it and pause AI for everyone
// (denial-of-wallet on availability; the rate limits alone don't stop it). This sub-cap, enforced by
// ai_user_budget_check against a per-user DEFINER ledger, bounds any single account to its own slice.
// Must stay below BUDGET_CAP_MICROS to mean anything (asserted in guardrails.test.ts; also a CHECK in
// app_config).
export const USER_BUDGET_CAP_MICROS = 10_000_000

// Per-call clamp mirrored from ai_budget_add's SQL ceiling (20260706000000): each add is capped at
// this many micros server-side, so a user's monthly spend can only ever advance in ≤ this-size steps.
// recordUsage reconstructs the pre-call total from it to detect the alert-threshold crossing. This is
// a FIXED safety rail — NOT owner-editable (unlike the caps/limits above).
export const PER_CALL_CEILING_MICROS = 200_000

// The owner spend-alert threshold is this fraction of the (live) per-user cap: page the owner once
// when an account first crosses it, BEFORE it hits the wall. recordUsage derives the threshold from
// the live cap; the constant below is the fallback-cap value ($8 = 80% of the default $10 sub-cap).
export const SPEND_ALERT_FRACTION = 0.8

// Default owner spend-alert threshold = 80% of the default per-user cap ($8). Kept for tests /
// back-compat; recordUsage uses the fraction against the live cap.
export const USER_SPEND_ALERT_MICROS = 8_000_000

// ─── model knobs (2026-08-20, phase-0 cost scaling) ─────────────────────────────────────────────

// Anthropic list pricing in MICRO-DOLLARS PER TOKEN (micros = tokens × rate). Verified 2026-08-20:
// haiku-4-5 $1/$5, sonnet-5 $3/$15 standard ($2/$10 introductory through 2026-08-31 — the standard
// rate conservatively over-counts until then, the safe direction for a kill-switch), opus-5 $5/$25.
// costMicros (guardrails.ts) reads this table; an UNKNOWN model id falls back to the Sonnet row.
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-opus-5': { input: 5, output: 25 },
}

// Per-feature model ALLOWLISTS — mirror the app_config CHECK constraints (migration
// 20260820210850); keep the three in sync (SQL CHECK, app_config_set validation, these arrays).
// Chat excludes Opus BY DESIGN: a worst-case chat call (~60k input tokens, ai-chat
// MAX_TOTAL_CHARS) on Opus would breach the fixed $0.20 per-call clamp (PER_CALL_CEILING_MICROS).
// The plan path's prompt is small — worst case ≈ $0.10 on Opus (pinned in guardrails.test.ts) —
// so plan may run Opus and the clamp stays untouched.
export const ALLOWED_CHAT_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5'] as const
export const ALLOWED_PLAN_MODELS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'] as const

// Defaults when app_config is unreadable or predates the model columns — the pre-knob behavior.
export const DEFAULT_CHAT_MODEL = 'claude-sonnet-5'
export const DEFAULT_PLAN_MODEL = 'claude-sonnet-5'

// Default base of the scaled monthly budget, $10.00 (effective cap = min(base + perUserCap ×
// activeUsers, global ceiling, $100 HARD_MAX) — enforcement lands in the cap-scaling follow-up).
export const AI_BUDGET_BASE_MICROS = 10_000_000

// ─── prompt caching (2026-08-20, phase-0 PR 3) ─────────────────────────────────────────────────

// Anthropic prompt-cache billing, as multiples of the model's INPUT rate: a cache WRITE
// (usage.cache_creation_input_tokens, 5-min TTL) bills at 1.25×, a cache READ
// (usage.cache_read_input_tokens) at 0.1×. Once any request carries cache_control,
// usage.input_tokens is the UNCACHED REMAINDER only — costMicros must add these two terms or the
// budget kill-switch under-counts every cached call. Fixed by Anthropic's price sheet, not tunable.
export const CACHE_WRITE_INPUT_MULTIPLIER = 1.25
export const CACHE_READ_INPUT_MULTIPLIER = 0.1
