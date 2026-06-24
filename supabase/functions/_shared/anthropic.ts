// Anthropic client factory — the OWNER's key, read from the ANTHROPIC_API_KEY secret
// (`supabase secrets set`). Server-side only; the key is NEVER in any VITE_* var or the
// frontend bundle. The first real caller is plan-my-day (PR3); ai-chat (PR4) reuses this.
//
// Model choice: claude-sonnet-4-6 for both AI features (cost-aware; see ADR-0015). MAX_TOKENS
// is intentionally small to bound output-token cost per turn (the budget kill-switch is the
// backstop; this is the per-call cap).

import Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'

export const MODEL = 'claude-sonnet-4-6'
export const MAX_TOKENS = 2048

export function anthropic(): Anthropic {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey)
    throw new Error('ANTHROPIC_API_KEY is not set (supabase secrets set ANTHROPIC_API_KEY=…)')
  return new Anthropic({ apiKey })
}
