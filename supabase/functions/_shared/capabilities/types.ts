// capabilities/types.ts — the transport-agnostic capability layer's core types.
//
// A "capability" is one thing the user can do to THEIR OWN planner (create a task, check off a
// habit, plan the day, …). The layer is deliberately free of any Anthropic / MCP types: a
// capability knows only about a Supabase client (the caller's, RLS-scoped), a zod input schema,
// and an execute() that returns narratable text. The Anthropic tool-use adapter
// (../chat-tools.ts) and any future MCP server both consume THIS registry — see ./README.md.

import type { z } from 'npm:zod@4.4.3'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

// Domains of user data a capability can mutate. The chat's live-refresh maps each to a TanStack
// Query key (see src/features/ai/use-ai-chat.ts) so the grid / list / habits / Done UI updates
// the instant a tool runs.
export type MutationDomain = 'tasks' | 'habits' | 'daily_state' | 'history' | 'reminders'

// Services a capability MAY need but that live OUTSIDE the transport-agnostic layer (they pull in
// the owner's Anthropic key, guardrails, etc.). Injected via context so the registry itself
// imports none of that. Optional: an MCP host that doesn't wire a service still gets every pure
// DB capability, and a capability that needs a missing service degrades gracefully.
export interface CapabilityServices {
  // Runs the existing Plan My Day path server-side for the caller and persists today's plan.
  // Wired by ai-chat to ../run-plan.ts; carries its own plan_my_day rate-limit + budget gate.
  generatePlan?: () => Promise<{ ok: true; headline: string } | { ok: false; reason: string }>
}

export interface CapabilityContext {
  // Caller-JWT-scoped client → RLS applies and auth.uid() is the real user. The layer NEVER
  // receives a service-role client; the model can at worst touch the caller's own rows.
  client: SupabaseClient
  timeZone: string // user's IANA zone (user_schedule.timezone) for local-day math
  now?: Date // injectable for deterministic tests
  services?: CapabilityServices
}

export interface CapabilityResult {
  content: string // narratable text fed back to the MODEL as the tool_result (may carry ids / JSON)
  isError: boolean
  mutated?: MutationDomain[] // which data domains changed → drives the UI live-refresh
  // What the USER sees in the chat activity line — kept free of ids, raw JSON and DB error text.
  // Omit to reuse `content` (fine for tools whose content is already a plain sentence); set to
  // null to hide the tool from the user entirely (internal read-only lookups the model runs to
  // refresh its view before acting). The two audiences differ: the model needs the id to chain a
  // follow-up edit; the user just wants "Created X on the grid."
  display?: string | null
}

// One capability. `schema` (zod) is the ONE source of truth: it validates input at execution AND
// (via z.toJSONSchema in the adapter) renders the JSON Schema an Anthropic / MCP client
// advertises — no hand-kept second copy to drift. No Anthropic or MCP type appears here.
export interface Capability<I = unknown> {
  name: string
  description: string
  schema: z.ZodType<I>
  destructive: boolean // requires human confirmation before executing (server-classified, never trusted from the model)
  execute(ctx: CapabilityContext, input: I): Promise<CapabilityResult>
}

// Declare a capability with its input type inferred from the zod schema (so execute's `input` is
// typed without repeating the generic). destructive defaults to false.
export function defineCapability<S extends z.ZodType>(c: {
  name: string
  description: string
  schema: S
  destructive?: boolean
  execute(ctx: CapabilityContext, input: z.infer<S>): Promise<CapabilityResult>
}): Capability<z.infer<S>> {
  // The cast bridges Zod 4's invariant internal type params — the shapes match structurally, and
  // execute is a method (bivariant), so each Capability<Concrete> still fits Capability[] below.
  return { destructive: false, ...c } as unknown as Capability<z.infer<S>>
}
