import {
  ScheduleConfigSchema,
  type ScheduleConfig,
  type AssistantTone,
  type AssistantVerbosity,
} from '../../types/user-schedule'
import { REMINDER_DEFAULT_MINUTES } from '../reminders/reminder-offsets'

// A flat, all-string form model for the Settings editor. Numbers stay as strings while editing
// (empty is allowed, a half-typed value stays put) and are parsed on save. draftToConfig() shapes
// the draft back into the nested ScheduleConfig the plan prompt reads, dropping empty fields so
// the stored config stays minimal, then validates it (caps + ranges) as a server-bound safety net.

// One recurring-commitment row while editing (both fields stay strings; empty rows drop on save).
export interface CommitmentDraft {
  label: string
  when: string
}

export interface SettingsDraft {
  location: string
  wakeTime: string
  workStart: string
  workEnd: string
  lunchStart: string
  lunchEnd: string
  bedtime: string
  weekdayFreeHours: string
  saturdayFreeHours: string
  saturdayNotes: string
  sundayFreeHours: string
  sundayNotes: string
  commitments: CommitmentDraft[]
  planNotes: string
  babyclawTone: '' | AssistantTone
  babyclawVerbosity: '' | AssistantVerbosity
  babyclawInstructions: string
  // Proactive notifications (ADR-0031). enabled is the toggle; hours are '' until set.
  notificationsEnabled: boolean
  notificationsName: string
  morningHour: string
  eveningHour: string
  quietStartHour: string
  quietEndHour: string
  // Per-task reminder default (ADR 2026-07-09). 'off' | minutes-as-string ('0'|'10'|…). Seeded
  // to the app default ('60') so the selector shows "1 hour before" until the user changes it.
  reminderDefault: string
}

export const EMPTY_DRAFT: SettingsDraft = {
  location: '',
  wakeTime: '',
  workStart: '',
  workEnd: '',
  lunchStart: '',
  lunchEnd: '',
  bedtime: '',
  weekdayFreeHours: '',
  saturdayFreeHours: '',
  saturdayNotes: '',
  sundayFreeHours: '',
  sundayNotes: '',
  commitments: [],
  planNotes: '',
  babyclawTone: '',
  babyclawVerbosity: '',
  babyclawInstructions: '',
  notificationsEnabled: false,
  notificationsName: '',
  morningHour: '',
  eveningHour: '',
  quietStartHour: '',
  quietEndHour: '',
  reminderDefault: String(REMINDER_DEFAULT_MINUTES),
}

const numToStr = (n: number | undefined): string => (n == null ? '' : String(n))

export function configToDraft(config: ScheduleConfig | null | undefined): SettingsDraft {
  const c = config ?? {}
  const wd = c.weekday ?? {}
  const sat = c.weekend?.saturday ?? {}
  const sun = c.weekend?.sunday ?? {}
  // `assistant` is canonical (Settings + the chat self-write both use it). Fall back to the legacy
  // `babyclaw` key so an old value still pre-fills the editor; saving rewrites it as `assistant`
  // and drops `babyclaw`. Remove the fallback once no stored config carries `babyclaw` (2026-07-09).
  const baby = c.assistant ?? c.babyclaw ?? {}
  const notif = c.notifications ?? {}
  return {
    location: c.location ?? '',
    wakeTime: wd.wakeTime ?? '',
    workStart: wd.workStart ?? '',
    workEnd: wd.workEnd ?? '',
    lunchStart: wd.lunchStart ?? '',
    lunchEnd: wd.lunchEnd ?? '',
    bedtime: wd.bedtime ?? '',
    weekdayFreeHours: numToStr(wd.freeTimeEstimateHours),
    saturdayFreeHours: numToStr(sat.freeTimeEstimateHours),
    saturdayNotes: sat.notes ?? '',
    sundayFreeHours: numToStr(sun.freeTimeEstimateHours),
    sundayNotes: sun.notes ?? '',
    commitments: (c.commitments ?? []).map((x) => ({ label: x.label, when: x.when ?? '' })),
    planNotes: c.planNotes ?? '',
    babyclawTone: baby.tone ?? '',
    babyclawVerbosity: baby.verbosity ?? '',
    babyclawInstructions: baby.customInstructions ?? '',
    notificationsEnabled: notif.enabled ?? false,
    notificationsName: notif.name ?? '',
    morningHour: numToStr(notif.morningHour),
    eveningHour: numToStr(notif.eveningHour),
    quietStartHour: numToStr(notif.quietStartHour),
    quietEndHour: numToStr(notif.quietEndHour),
    // three-state → string: null → 'off'; absent → the app default; a number → itself.
    reminderDefault:
      notif.reminderDefaultMinutes === null
        ? 'off'
        : notif.reminderDefaultMinutes === undefined
          ? String(REMINDER_DEFAULT_MINUTES)
          : String(notif.reminderDefaultMinutes),
  }
}

const str = (s: string): string | undefined => {
  const t = s.trim()
  return t ? t : undefined
}
const clamped =
  (min: number, max: number) =>
  (s: string): number | undefined => {
    const t = s.trim()
    if (!t) return undefined
    const n = Number(t)
    if (!Number.isFinite(n)) return undefined
    return Math.min(max, Math.max(min, n))
  }
const hours = clamped(0, 24)
const hour24 = clamped(0, 23) // a wall-clock hour 0–23

// Drop undefined values; return undefined when the object ends up empty so we never persist `{}`
// sub-objects (keeps the stored jsonb minimal and the plan prompt's `if (field)` guards simple).
function compact<T extends Record<string, unknown>>(obj: T): T | undefined {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v
  return Object.keys(out).length ? (out as T) : undefined
}

export function draftToConfig(draft: SettingsDraft): ScheduleConfig {
  const weekday = compact({
    wakeTime: str(draft.wakeTime),
    workStart: str(draft.workStart),
    workEnd: str(draft.workEnd),
    lunchStart: str(draft.lunchStart),
    lunchEnd: str(draft.lunchEnd),
    bedtime: str(draft.bedtime),
    freeTimeEstimateHours: hours(draft.weekdayFreeHours),
  })
  const saturday = compact({
    freeTimeEstimateHours: hours(draft.saturdayFreeHours),
    notes: str(draft.saturdayNotes),
  })
  const sunday = compact({
    freeTimeEstimateHours: hours(draft.sundayFreeHours),
    notes: str(draft.sundayNotes),
  })
  const weekend = compact({ saturday, sunday })
  // Keep only rows with a real label; carry `when` only when present. Empty rows never persist.
  const commitments = draft.commitments
    .map((c) => ({ label: str(c.label), when: str(c.when) }))
    .filter((c): c is { label: string; when: string | undefined } => c.label !== undefined)
    .map((c) => (c.when === undefined ? { label: c.label } : { label: c.label, when: c.when }))
  // Canonical key. We never write the legacy `babyclaw` key, so the first save after this change
  // migrates an old config forward (configToDraft read it; draftToConfig drops it).
  const assistant = compact({
    tone: draft.babyclawTone || undefined,
    verbosity: draft.babyclawVerbosity || undefined,
    customInstructions: str(draft.babyclawInstructions),
  })
  // Hours persist whenever set (they're preferences); `enabled` is the gate the dispatcher checks.
  // A never-touched notifications section compacts away entirely (no `{}` block persisted).
  const notifications = compact({
    enabled: draft.notificationsEnabled || undefined,
    name: str(draft.notificationsName),
    morningHour: hour24(draft.morningHour),
    eveningHour: hour24(draft.eveningHour),
    quietStartHour: hour24(draft.quietStartHour),
    quietEndHour: hour24(draft.quietEndHour),
    // 'off' → null (persisted); the app default → undefined (never stored — reads back as the
    // default); any other preset → the number. `compact` keeps null but drops undefined.
    reminderDefaultMinutes:
      draft.reminderDefault === 'off'
        ? null
        : draft.reminderDefault === '' ||
            Number(draft.reminderDefault) === REMINDER_DEFAULT_MINUTES ||
            !Number.isFinite(Number(draft.reminderDefault))
          ? undefined
          : Number(draft.reminderDefault),
  })
  const raw = compact({
    location: str(draft.location),
    weekday,
    weekend,
    commitments: commitments.length ? commitments : undefined,
    planNotes: str(draft.planNotes),
    assistant,
    notifications,
  })
  return ScheduleConfigSchema.parse(raw ?? {})
}
