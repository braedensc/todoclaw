// The old EisenClaw flat-JSON shapes (planning/eisenclaw-export/docs/todoclaw.md). Kept minimal
// — only the fields this importer reads. `planning/` is gitignored reference material; these
// types describe its shape without copying its contents.

export interface OldRecurring {
  frequencyDays: number
  lastDoneAt: string | null
}

export interface OldTask {
  id: string
  text: string
  bucket: string
  x: number
  y: number
  due: string // ISO date, or '' for none
  staged: boolean
  recurring?: OldRecurring
  createdAt?: string
}

export interface OldSubtask {
  id: string
  text: string
}

export interface OldHabit {
  id: string
  text: string
  active: boolean
  subtasks: OldSubtask[]
}

export interface OldHistoryEntry {
  taskId: string
  text: string
  bucket: string
  completedAt: string
}

export interface OldPlannerState {
  tasks: OldTask[]
  habits: OldHabit[]
  history?: OldHistoryEntry[]
  lastReset: string
  _clientRev: number
}

// data/user-schedule-<user>.json — only `timezone` is structurally significant (hoisted to its
// own column in public.user_schedule); everything else is opaque Plan-My-Day context that goes
// into `config` jsonb verbatim.
export interface OldUserSchedule {
  timezone: string
  [key: string]: unknown
}
