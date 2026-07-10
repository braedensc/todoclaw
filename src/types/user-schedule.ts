import { z } from 'zod'

// One source of truth: this Zod schema validates `user_schedule` rows at the Supabase
// boundary and its inferred type IS the app's UserSchedule type. Mirrors
// supabase/migrations/*_create_user_schedule.sql.
//
// `timezone` is hoisted to its own column because it drives the timezone-correct daily
// reset (see the migration). `config` is jsonb — no migration is needed to shape it, so we
// formalize it here as ScheduleConfigSchema. The Settings editor is the only writer for the
// schedule/notifications keys; `assistant` (BabyClaw tuning) has TWO writers — this editor and
// BabyClaw's own set_assistant_preference chat tool — so it's "one field, two surfaces". The
// Plan My Day edge function (supabase/functions/_shared/plan-prompt.ts) reads the same keys
// server-side; keep the key names in sync. BabyClaw reads `config.assistant` (tone/verbosity/note)
// + `planNotes` defensively server-side (chat-context.ts parseAssistant) — this module owns the
// canonical shape.
//
// Freeform, user-supplied fields are LENGTH-CAPPED here as one layer of defense: they are
// injected into AI prompts as *preferences*, never as instructions, so a hard cap plus the
// "treat as data" prompt scaffolding keeps them from ballooning cost or escaping scope.

// ---- Caps (shared with the editor's maxLength attrs) -----------------------------------------
export const PLAN_NOTES_MAX = 500
export const ASSISTANT_INSTRUCTIONS_MAX = 500
const SHORT_MAX = 120 // location, commitment label/when, single-line context
const TIME_MAX = 40 // time-of-day strings / ranges, e.g. "9:30", "12:00–1:00pm"
const NOTES_MAX = 280 // per-day free-text notes

const shortText = z.string().trim().max(SHORT_MAX)
const timeText = z.string().trim().max(TIME_MAX)
const notesText = z.string().trim().max(NOTES_MAX)

// ---- BabyClaw assistant tuning (folded into the chat prompt server-side, chat-prompt.ts) --------
// ONE canonical vocabulary shared with the server (chat-prompt.ts AssistantConfig / configLines and
// capabilities/preferences.ts). Every value here must be one the prompt can act on — don't add a
// choice the server doesn't teach. Superset agreed 2026-07-09 (Settings had direct/balanced/detailed,
// the server had playful/normal; unified so both surfaces write the same field with the same words).
export const ASSISTANT_TONES = ['warm', 'neutral', 'playful', 'direct'] as const
export const ASSISTANT_VERBOSITY = ['brief', 'balanced', 'detailed'] as const
export type AssistantTone = (typeof ASSISTANT_TONES)[number]
export type AssistantVerbosity = (typeof ASSISTANT_VERBOSITY)[number]

// Legacy verbosity 'normal' (written by set_assistant_preference before the vocab was unified,
// 2026-07-09) maps to 'balanced' on read. Map it BEFORE the enum check so an old value validates
// instead of throwing — a throw here would trip ScheduleConfigSchema's `.catch({})` below and wipe
// the user's ENTIRE config. Remove once no stored config carries 'normal'.
const assistantVerbosity = z.preprocess(
  (v) => (v === 'normal' ? 'balanced' : v),
  z.enum(ASSISTANT_VERBOSITY),
)

const assistantSchema = z.object({
  tone: z.enum(ASSISTANT_TONES).optional(),
  verbosity: assistantVerbosity.optional(),
  customInstructions: z.string().trim().max(ASSISTANT_INSTRUCTIONS_MAX).optional(),
})

// ---- Schedule (modeled on planning/eisenclaw-export/data/user-schedule-braeden.json) ---------
const weekdaySchema = z.object({
  wakeTime: timeText.optional(),
  workStart: timeText.optional(),
  workEnd: timeText.optional(),
  lunchStart: timeText.optional(),
  lunchEnd: timeText.optional(),
  bedtime: timeText.optional(),
  freeTimeEstimateHours: z.number().min(0).max(24).optional(),
  notes: notesText.optional(),
})

const weekendDaySchema = z.object({
  freeTimeEstimateHours: z.number().min(0).max(24).optional(),
  notes: notesText.optional(),
})

// ---- Recurring commitments -------------------------------------------------------------------
// User-listed fixed obligations (gym, school pickup, standing meetings) the planner treats like
// blocks already on the calendar: it works AROUND them and never proposes one as a task. Replaces
// the old running/marathon fields with a general, non-personal shape. Length-capped like every
// other freeform field; the array is length-capped too.
export const COMMITMENTS_MAX = 12
const commitmentSchema = z.object({
  label: z.string().trim().min(1).max(SHORT_MAX), // what it is, e.g. "Gym"
  when: shortText.optional(), // when it happens, e.g. "Tue/Thu 6pm" (freeform)
})

// ---- Proactive notifications (ADR-0031) ------------------------------------------------------
// Opt-in, default-off. `enabled` plus a live push subscription is what makes a user a dispatch
// candidate (supabase/functions/_shared/dispatch.ts). Hours are LOCAL integers (0–23), matched
// against the user's timezone by the dispatcher; quiet hours suppress a window (wraps past midnight).
const localHour = z.number().int().min(0).max(23)
const notificationsSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().max(40).optional(), // greeting name ("Good morning Alex! ☀️")
  morningHour: localHour.optional(), // when the daily plan is pushed
  eveningHour: localHour.optional(), // when the recap is pushed
  quietStartHour: localHour.optional(),
  quietEndHour: localHour.optional(),
  // Opt-in, default-off: suppress a daily push when it would have nothing to say — an empty
  // "clear slate" morning or a no-plan-nothing-on-the-board evening (see dispatch.ts). Absent =
  // send always (current behavior); the dispatcher reads it off config.notifications.
  quietWhenEmpty: z.boolean().optional(),
  // Per-task reminder default (ADR 2026-07-09): minutes before a timed task is due to pre-select
  // in the add flow. `null` = off (no auto reminder); ABSENT = the app default (1 hour) — so an
  // untouched config never has to store it. Bounded to 28 days, like task_reminders.offset_minutes.
  reminderDefaultMinutes: z.number().int().min(0).max(40320).nullable().optional(),
})

// ---- Onboarding (first-run setup guide) ------------------------------------------------------
// Account-level so a device-INDEPENDENT fact — "I've seen the tour" — survives the localStorage
// partition split between a browser tab and the installed PWA (display-mode: standalone gets its
// own storage). The rest of the setup-guide state stays per-device localStorage (install +
// notifications ARE per-device), but the tour checkmark shouldn't reset just because the app was
// opened from the Home Screen instead of Safari. See setup-guide-store.ts.
const onboardingSchema = z.object({
  tourSeen: z.boolean().optional(),
})

export const ScheduleConfigSchema = z.object({
  location: shortText.optional(),
  onboarding: onboardingSchema.optional(),
  weekday: weekdaySchema.optional(),
  weekend: z
    .object({
      saturday: weekendDaySchema.optional(),
      sunday: weekendDaySchema.optional(),
    })
    .optional(),
  commitments: z.array(commitmentSchema).max(COMMITMENTS_MAX).optional(),
  // Bounded freeform preferences for Plan My Day — layered onto the fixed prompt scaffold.
  planNotes: z.string().trim().max(PLAN_NOTES_MAX).optional(),
  assistant: assistantSchema.optional(),
  // DEPRECATED legacy alias: the Settings editor wrote `babyclaw` (with a divergent vocab) before it
  // was unified onto `assistant`, 2026-07-09. Kept here (read-only) so configToDraft can migrate an
  // old value into the editor and the server's parseAssistant fallback keeps honoring it; the same
  // enums parse it (old values are all in the superset). draftToConfig writes only `assistant`, so
  // the first Settings re-save drops it. Remove once no stored config carries `babyclaw`.
  babyclaw: assistantSchema.optional(),
  notifications: notificationsSchema.optional(),
})
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>

export const UserScheduleSchema = z.object({
  user_id: z.string(),
  timezone: z.string().min(1), // IANA name, e.g. "America/New_York"
  // `.catch({})` keeps a malformed/legacy config from ever crashing app load — a bad shape
  // degrades to an empty config (the editor can then rewrite it) rather than throwing.
  config: ScheduleConfigSchema.catch({}),
  created_at: z.string(),
  updated_at: z.string(),
})

export type UserSchedule = z.infer<typeof UserScheduleSchema>
