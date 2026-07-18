// Shapes for the checked-in demo seed data (data.ts). Deliberately minimal — only the fields
// the seed inserts — and already in the CURRENT schema's shape (supabase/migrations/*_create_tasks
// .sql, *_create_habits.sql, *_history_and_daily_state_rpc.sql, *_create_user_schedule.sql), so no
// legacy mapping/coercion is needed. Fake sample content only; nothing personal.

export interface SeedRecurring {
  frequencyDays: number
  lastDoneAt: string | null // ISO timestamp; null until first completion
  doneCount: number
}

export interface SeedTask {
  text: string
  x: number | null // urgency 0..1 (left→right)
  y: number | null // importance 0..1 (bottom→top; y is data-space, inverted from screen)
  due: string | null // wall-clock 'YYYY-MM-DD' or null for none
  staged: boolean // true = parked off the board; false = a live/active row
  bucket: 'oneoff'
  recurring: SeedRecurring | null
  created_at: string // ISO timestamp
}

export interface SeedSubtask {
  id: string
  text: string
}

export interface SeedHabit {
  text: string
  active: boolean
  subtasks: SeedSubtask[]
}

export interface SeedHistoryEntry {
  text: string
  bucket: 'oneoff' | null
  completed_at: string // ISO timestamp
}

export interface SeedUserSchedule {
  timezone: string // IANA name — drives the timezone-correct daily reset
  config: Record<string, unknown> // opaque Plan-My-Day context (location, windows, ...)
}

export interface SeedState {
  tasks: SeedTask[]
  habits: SeedHabit[]
  history: SeedHistoryEntry[]
  schedule: SeedUserSchedule
}
