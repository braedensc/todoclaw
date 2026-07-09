// capabilities/helpers.ts — small shared executor helpers. Every DB write goes through the
// caller's JWT client (RLS applies); .select() after an update confirms a row actually matched so
// a hallucinated id becomes a clear "not found" instead of a silent no-op.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import type { CapabilityResult, MutationDomain } from './types.ts'

// `display` (optional) is the user-facing chat line when it must differ from the model-facing
// `content`: pass a plain sentence to override, or null to hide the tool from the user entirely
// (internal reads). Omit it to reuse `content` (already-plain confirmations don't need it).
export const ok = (
  content: string,
  mutated?: MutationDomain[],
  display?: string | null,
): CapabilityResult => ({
  content,
  isError: false,
  ...(mutated ? { mutated } : {}),
  ...(display !== undefined ? { display } : {}),
})

// A hand-written, user-safe failure (e.g. "I couldn't find that task."). `content` is shown to
// both the model and the user — only pass plain language here, never a raw system message.
export const err = (content: string): CapabilityResult => ({ content, isError: true })

// A DB / system failure: the raw message goes to the MODEL only (so it can self-correct or retry),
// while the USER always sees a generic line — Postgres / system text is never chat. Use this at
// every `if (error) ...` site so technical detail can never reach the user anywhere in the app.
const GENERIC_ERROR = 'Something went wrong on my end — please try again.'
export const systemErr = (
  rawMessage: string,
  display: string = GENERIC_ERROR,
): CapabilityResult => ({
  content: rawMessage,
  isError: true,
  display,
})

// Update a live task by id under RLS. Returns a `${verb} "text"` confirmation, or a not-found
// error when zero rows matched. Always mutates the 'tasks' domain.
export async function updateTaskRow(
  client: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
  verb: string,
): Promise<CapabilityResult> {
  const { data, error } = await client
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select('text')
    .maybeSingle()
  if (error) return systemErr(error.message)
  if (!data) return err("I couldn't find that task.")
  return ok(`${verb} "${data.text}".`, ['tasks'])
}

// Update a live habit by id under RLS. Mirrors updateTaskRow for the habits table.
export async function updateHabitRow(
  client: SupabaseClient,
  id: string,
  patch: Record<string, unknown>,
  verb: string,
): Promise<CapabilityResult> {
  const { data, error } = await client
    .from('habits')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select('text')
    .maybeSingle()
  if (error) return systemErr(error.message)
  if (!data) return err("I couldn't find that habit.")
  return ok(`${verb} "${data.text}".`, ['habits'])
}

// Load a live habit's embedded subtasks array (for the read-modify-write step edits). Returns
// null when the habit doesn't exist / isn't the caller's.
export async function loadHabitSubtasks(
  client: SupabaseClient,
  habitId: string,
): Promise<{ text: string; subtasks: { id: string; text: string }[] } | null> {
  const { data, error } = await client
    .from('habits')
    .select('text, subtasks')
    .eq('id', habitId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !data) return null
  const subtasks = Array.isArray(data.subtasks)
    ? (data.subtasks as { id: string; text: string }[])
    : []
  return { text: data.text as string, subtasks }
}
