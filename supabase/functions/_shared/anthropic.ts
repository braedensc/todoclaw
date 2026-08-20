// Anthropic client factory — the OWNER's key, read from the ANTHROPIC_API_KEY secret
// (`supabase secrets set`). Server-side only; the key is NEVER in any VITE_* var or the
// frontend bundle.
//
// Model choice (2026-08-20): the model is now a RUNTIME KNOB — each AI feature reads its model
// from app_config via loadConfig() (cfg.chatModel / cfg.planModel, allowlisted per feature in
// guardrails-constants.ts) and passes it explicitly to messages.create. MODEL below is the
// DEFAULT (claude-sonnet-5 — cost-aware: $3/$15 standard, $2/$10 introductory through
// 2026-08-31), kept as a static export because config-less callers (the eval judge,
// evals/lib/judge.ts) pin to it. MAX_TOKENS is intentionally small to bound output-token cost
// per turn (the budget kill-switch is the backstop; this is the per-call cap).

import Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { DEFAULT_CHAT_MODEL } from './guardrails-constants.ts'

export const MODEL = DEFAULT_CHAT_MODEL
export const MAX_TOKENS = 2048

export function anthropic(): Anthropic {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey)
    throw new Error('ANTHROPIC_API_KEY is not set (supabase secrets set ANTHROPIC_API_KEY=…)')
  return new Anthropic({ apiKey })
}
