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

// $20.00/month, in micro-dollars (millionths of a USD). Default global kill-switch cap.
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
