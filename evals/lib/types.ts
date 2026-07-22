// types.ts — the eval harness's scenario + result vocabulary.
//
// Three scenario kinds, matched to how each AI surface actually runs in prod:
//  - chat:  drives the REAL ai-chat edge function over HTTP against local Supabase (the multi-turn
//           tool loop, confirm gates, and capability execution live only there — ADR-0017).
//  - plan:  calls generatePlan() in-process with a fixture request (pure; clock pinned).
//  - recap: calls generateRecap() in-process with a fixture RecapRequest (pure).
//
// Every scenario carries two judgment layers: `checks` (deterministic, free, always run) and an
// optional `rubric` (LLM-as-judge, one API call). `expectFailUntil` marks scenarios that encode
// DESIRED behavior a not-yet-merged PR delivers — reported separately, never as regressions.

import type {
  PlanRequest,
  PlanResult,
  ScheduleConfig,
} from '../../supabase/functions/_shared/plan-prompt.ts'
import type { RecapRequest } from '../../supabase/functions/_shared/recap-prompt.ts'

export type { PlanRequest, PlanResult, ScheduleConfig, RecapRequest }

// ---------- seeding (chat scenarios) ----------

export interface SeedTask {
  /** Author handle for referencing this task in checks (id resolved at seed time). */
  key?: string
  text: string
  x?: number | null
  y?: number | null
  /** Wall-clock 'YYYY-MM-DD' (use dayOffsetISO — chat seeds must be now-relative). */
  due?: string | null
  /** 'HH:MM' local. */
  dueTime?: string | null
  staged?: boolean
  size?: 'S' | 'M' | 'L' | 'XL' | null
  ongoing?: boolean
  recurring?: { frequencyDays: number; lastDoneAt: string | null; doneCount: number } | null
  /** Future date = paused/dormant. */
  startDate?: string | null
  /** Permanent one-off completion instant. */
  completedAt?: string | null
  /** Mark done in today's daily_state. */
  doneToday?: boolean
  /** Reminder offsets in minutes-before-due (needs due + dueTime). */
  reminders?: number[]
}

export interface SeedHabit {
  key?: string
  text: string
  active?: boolean
  subtasks?: { id: string; text: string }[]
  doneToday?: boolean
}

export interface SeedSpec {
  timezone?: string
  /** user_schedule.config jsonb — planNotes, commitments, assistant{tone,verbosity,...},
   * notifications{reminderDefaultMinutes,...}, location, weekday/weekend. */
  scheduleConfig?: Record<string, unknown>
  tasks?: SeedTask[]
  habits?: SeedHabit[]
  memories?: string[]
  history?: { text: string; completedAt: string }[]
  /** Pre-inject the weather cache so plan paths never hit wttr.in. Also sets config.location. */
  weather?: { location: string; data: unknown }
  /** When true, the seed INSERTs fire the task_activity trigger (fabricates "today's activity"
   * for recap-style scenarios). Default false = trigger suppressed via the GUC. */
  activityToday?: boolean
}

/** Maps author `key`s to the real row ids the seed produced. */
export interface SeedIds {
  tasks: Record<string, string>
  habits: Record<string, string>
}

// ---------- chat traces ----------

export type Turn =
  | { say: string; seed?: string }
  | { confirm: true }
  | { deny: true; note?: string }

export interface ToolUseRec {
  id: string
  name: string
  input: unknown
}

export interface ToolResultRec {
  tool_use_id: string
  name: string
  ok: boolean
  summary: string
  display?: string | null
  mutated?: string[]
}

export interface TurnTrace {
  input: Turn
  events: Array<Record<string, unknown>>
  /** Concatenated text-deltas (the streamed assistant text, status line included). */
  text: string
  /** splitReply(text) — body with the [[status:]] marker stripped. */
  body: string
  status: string | null
  needsInput: boolean
  /** tool_use blocks from the committed `message` events (name + full input). */
  toolUses: ToolUseRec[]
  toolResults: ToolResultRec[]
  pending: { tool_use_id: string; name: string; summary: string } | null
  stopReason: string | null
  error: { code?: string; message?: string } | null
}

export interface ChatTrace {
  sessionId: string | null
  turns: TurnTrace[]
}

// ---------- DB snapshot (post-conversation assertions) ----------

export interface DbTaskRow {
  id: string
  text: string
  x: number | null
  y: number | null
  due: string | null
  due_time: string | null
  staged: boolean
  size: string | null
  ongoing: boolean
  recurring: { frequencyDays: number; lastDoneAt: string | null; doneCount: number } | null
  start_date: string | null
  completed_at: string | null
  deleted_at: string | null
}

export interface DbSnapshot {
  ids: SeedIds
  tasks: DbTaskRow[]
  reminders: { task_id: string; offset_minutes: number }[]
  memories: { id: string; content: string }[]
  dailyDone: Record<string, boolean>
  dailyHabitDone: Record<string, boolean>
  historyTexts: string[]
}

// ---------- checks + judging ----------

export interface CheckResult {
  name: string
  pass: boolean
  detail?: string
}

export type ChatCheck = (t: ChatTrace, db: DbSnapshot) => CheckResult | CheckResult[]
export type PlanCheck = (plan: PlanResult, sc: PlanScenario) => CheckResult | CheckResult[]
export type RecapCheck = (body: string, sc: RecapScenario) => CheckResult | CheckResult[]

export interface Judgment {
  verdict: 'pass' | 'fail'
  scores: Record<string, number>
  reasoning: string
}

// ---------- scenarios ----------

interface ScenarioBase {
  id: string
  title: string
  tags: string[]
  /** Which user archetype this exercises (doc only). */
  persona?: string
  /** LLM-judge instructions; omit for deterministic-only scenarios. */
  rubric?: string
  /** Encodes desired behavior a pending PR delivers; reported as "expected fail", not regression. */
  expectFailUntil?: string
}

export interface ChatScenario extends ScenarioBase {
  kind: 'chat'
  /** Thunk so now-relative dates are computed per run, never frozen at import. */
  seed: () => SeedSpec
  turns: Turn[]
  checks?: ChatCheck[]
}

/** Structurally compatible with plan-inputs.ts TaskRow (module-private there). */
export interface PlanTaskRow {
  id: string
  text: string
  x: number | null
  y: number | null
  due: string | null
  due_time: string | null
  size?: string | null
  staged: boolean
  recurring: { frequencyDays: number; lastDoneAt: string | null; doneCount: number } | null
  ongoing?: boolean | null
  start_date?: string | null
}

export interface PlanScenario extends ScenarioBase {
  kind: 'plan'
  timeZone?: string
  /** Raw rows fed through the REAL buildPlanRequest (selection logic under test too). */
  tasks: PlanTaskRow[]
  habits?: { text: string; active: boolean }[]
  doneMap?: Record<string, boolean>
  schedule?: ScheduleConfig | null
  weather?: string | null
  memories?: string[]
  checks?: PlanCheck[]
}

export interface RecapScenario extends ScenarioBase {
  kind: 'recap'
  request: RecapRequest
  checks?: RecapCheck[]
}

export type Scenario = ChatScenario | PlanScenario | RecapScenario

// ---------- run results ----------

export interface ScenarioResult {
  id: string
  kind: Scenario['kind']
  tags: string[]
  title: string
  expectFailUntil?: string
  deterministic: CheckResult[]
  judge?: Judgment
  /** Extra artifacts for the report (plan JSON, recap body, chat transcript render). */
  artifact?: unknown
  durationMs: number
  usage: { input: number; output: number }
  error?: string
}

export interface RunReport {
  startedAt: string
  gitRef: string
  model: string
  judgeModel: string | null
  results: ScenarioResult[]
}
