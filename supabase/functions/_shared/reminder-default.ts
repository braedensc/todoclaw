// reminder-default.ts — the "default reminder" a task receives when it gains a due time,
// server-side. Mirrors src/features/reminders/reminder-offsets.ts (client): the Settings field
// config.notifications.reminderDefaultMinutes is three-state — undefined (never set) → the
// built-in 1-hour default, null → Off (no auto reminder), a number → that many minutes before.
// The two copies are deliberately tiny; each side pins the shared values with its own tests.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

/** The built-in default offset (1 hour before) when the user never chose one. */
export const REMINDER_DEFAULT_MINUTES = 60

/** Resolve the three-state config field to an effective offset (null = off). */
export function effectiveReminderDefault(
  reminderDefaultMinutes: number | null | undefined,
): number | null {
  return reminderDefaultMinutes === undefined ? REMINDER_DEFAULT_MINUTES : reminderDefaultMinutes
}

/**
 * The effective default from a raw user_schedule.config value (jsonb, user-shaped — walked
 * defensively). A missing key or malformed value resolves to the built-in default; an explicit
 * null means the user chose Off.
 */
export function reminderDefaultFromConfig(config: unknown): number | null {
  const notif =
    config && typeof config === 'object'
      ? (config as Record<string, unknown>).notifications
      : undefined
  const raw =
    notif && typeof notif === 'object'
      ? (notif as Record<string, unknown>).reminderDefaultMinutes
      : undefined
  if (raw === null) return null
  return effectiveReminderDefault(
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined,
  )
}

/**
 * The caller's effective default, read from user_schedule.config (RLS-scoped client). A missing
 * row, missing key, or malformed value resolves to the built-in default — same as the client. An
 * ERRORED read resolves to Off instead: the caller writes a reminder on the answer, and a user who
 * explicitly chose Off must never get one because the config read hiccuped — fail toward doing
 * nothing, matching how a failed reminder write is handled.
 */
export async function loadReminderDefault(client: SupabaseClient): Promise<number | null> {
  const { data, error } = await client.from('user_schedule').select('config').maybeSingle()
  if (error) return null
  return reminderDefaultFromConfig(data?.config)
}
