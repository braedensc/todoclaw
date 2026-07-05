import {
  ScheduleConfigSchema,
  type ScheduleConfig,
  type BabyclawTone,
  type BabyclawVerbosity,
} from '../../types/user-schedule'

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
  babyclawTone: '' | BabyclawTone
  babyclawVerbosity: '' | BabyclawVerbosity
  babyclawInstructions: string
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
}

const numToStr = (n: number | undefined): string => (n == null ? '' : String(n))

export function configToDraft(config: ScheduleConfig | null | undefined): SettingsDraft {
  const c = config ?? {}
  const wd = c.weekday ?? {}
  const sat = c.weekend?.saturday ?? {}
  const sun = c.weekend?.sunday ?? {}
  const baby = c.babyclaw ?? {}
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
  const babyclaw = compact({
    tone: draft.babyclawTone || undefined,
    verbosity: draft.babyclawVerbosity || undefined,
    customInstructions: str(draft.babyclawInstructions),
  })
  const raw = compact({
    location: str(draft.location),
    weekday,
    weekend,
    commitments: commitments.length ? commitments : undefined,
    planNotes: str(draft.planNotes),
    babyclaw,
  })
  return ScheduleConfigSchema.parse(raw ?? {})
}
