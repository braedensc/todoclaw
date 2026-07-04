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
  sundayLongRun: string
  sundayNotes: string
  race: string
  raceMonth: string
  preferredTime: string
  currentMPW: string
  peakMPW: string
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
  sundayLongRun: '',
  sundayNotes: '',
  race: '',
  raceMonth: '',
  preferredTime: '',
  currentMPW: '',
  peakMPW: '',
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
  const run = c.running ?? {}
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
    sundayLongRun: sun.longRunWindow ?? '',
    sundayNotes: sun.notes ?? '',
    race: run.race ?? '',
    raceMonth: run.raceMonth ?? '',
    preferredTime: run.preferredTime ?? '',
    currentMPW: numToStr(run.currentMPW),
    peakMPW: numToStr(run.peakMPW),
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
const mpw = clamped(0, 300)

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
    longRunWindow: str(draft.sundayLongRun),
    notes: str(draft.sundayNotes),
  })
  const weekend = compact({ saturday, sunday })
  const running = compact({
    currentMPW: mpw(draft.currentMPW),
    peakMPW: mpw(draft.peakMPW),
    race: str(draft.race),
    raceMonth: str(draft.raceMonth),
    preferredTime: str(draft.preferredTime),
  })
  const babyclaw = compact({
    tone: draft.babyclawTone || undefined,
    verbosity: draft.babyclawVerbosity || undefined,
    customInstructions: str(draft.babyclawInstructions),
  })
  const raw = compact({
    location: str(draft.location),
    weekday,
    weekend,
    running,
    planNotes: str(draft.planNotes),
    babyclaw,
  })
  return ScheduleConfigSchema.parse(raw ?? {})
}
