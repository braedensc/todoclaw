// Plan My Day — prompt + structured output. A redesign of EisenClaw's buildPlanPrompt
// (planning/eisenclaw-export/scripts/planner-server.js), kept faithful to its inputs (schedule
// slots, weather, "habits must appear", weekend/Sunday handling, "never schedule running") but
// restructured for reliability: assess-urgency-first, an explicit "a light/rest day is valid"
// path, firmer "don't cram", and a SCHEMA-ENFORCED output via forced tool use (emit_plan) instead
// of the original's brittle ```json-fence stripping.

import { z } from 'npm:zod@4.4.3'

// ---- Client payload (validated at the function boundary) -------------------------------------
// The frontend builds this from its existing hooks + lib (taskScore / recurringStatus / daysUntil),
// so the on-grid filtering and scoring stay in one place (src/lib). importance/urgency are 0–100.
export const PlanRequestSchema = z.object({
  today: z.string().min(1), // human-readable, e.g. "Wednesday, June 24, 2026"
  dayOfWeek: z.string().min(1), // e.g. "Wednesday"
  tasks: z
    .array(
      z.object({
        text: z.string(),
        importance: z.number(), // 0–100 (y*100)
        urgency: z.number(), // 0–100 (x*100)
        due: z.string().nullable(), // ISO date or null
        dueInDays: z.number().nullable(), // negative = overdue, 0 = today
      }),
    )
    .max(200),
  recurringDue: z.array(z.object({ text: z.string(), status: z.string() })).max(100), // overdue/due/soon recurring chores
  habits: z.array(z.string()).max(100), // active habit names
})
export type PlanRequest = z.infer<typeof PlanRequestSchema>

// ---- Output shape (the emit_plan tool input) -------------------------------------------------
export const WHEN_VALUES = ['morning', 'lunch', 'afternoon', 'evening'] as const
export interface Rock {
  task: string
  why: string
  duration: string
  when: (typeof WHEN_VALUES)[number]
}
export interface PlanResult {
  headline: string
  availableTime: string
  bigRock: Rock | null
  smallRocks: Rock[]
  habitNote: string
}

const rockSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: { type: 'string', description: 'The task to do.' },
    why: { type: 'string', description: 'One short sentence on why it earns time today.' },
    duration: { type: 'string', description: 'Rough estimate, e.g. "~30min", "~1.5h".' },
    when: { type: 'string', enum: WHEN_VALUES, description: 'Which time slot to do it in.' },
  },
  required: ['task', 'why', 'duration', 'when'],
}

// Forced-tool-use is how we get guaranteed-parseable structured output (no fence stripping).
export const EMIT_PLAN_TOOL = {
  name: 'emit_plan',
  description: "Return today's focused plan in the required structure.",
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      headline: {
        type: 'string',
        description: 'One punchy sentence framing the day (relaxed/encouraging on light days).',
      },
      availableTime: {
        type: 'string',
        description: "Brief plain-English summary of today's free time.",
      },
      bigRock: {
        anyOf: [{ type: 'null' }, rockSchema],
        description: 'The one task worth focusing on today, or null on a light/rest day.',
      },
      smallRocks: {
        type: 'array',
        items: rockSchema,
        description: '0–3 quick wins that fit around the big rock; [] on a genuinely light day.',
      },
      habitNote: {
        type: 'string',
        description: "One encouraging sentence about today's habits.",
      },
    },
    required: ['headline', 'availableTime', 'bigRock', 'smallRocks', 'habitNote'],
  },
} as const

// ---- Prompt ----------------------------------------------------------------------------------

export const SYSTEM_PROMPT = [
  "You are todoclaw, the user's Eisenhower-matrix daily planner. You produce a focused, realistic",
  'plan for *today* from their task grid, recurring chores, habits, schedule, and the weather.',
  '',
  'How to think (in order):',
  '1. ASSESS THE URGENCY LANDSCAPE FIRST. Look across all due dates and urgency/importance scores',
  '   before deciding how much to assign. Anything due within ~2 days is top priority and must',
  '   appear. Do not cram a task into today just because it exists — if it is due weeks out, leave',
  '   it for later in the month.',
  '2. PICK AT MOST ONE big rock — the single thing that genuinely warrants focus today (urgent, due',
  '   soon, or high-importance and a good fit for the day). On a light day, set bigRock to null.',
  '3. ADD 0–3 small rocks. Default to ONE. Add more only when several deadlines are truly imminent.',
  '   A relaxed day with one or two things is perfectly valid and healthy — say so plainly.',
  '4. RESPECT THE SCHEDULE. Assign each rock a slot (morning/lunch/afternoon/evening) that fits the',
  "   user's real availability. Never schedule or even mention running — treat it like work that is",
  '   already on the calendar.',
  '5. HABITS: acknowledge the active habits encouragingly in habitNote (they always appear).',
  '',
  'Be concrete and honest. Durations are rough (~30min, ~1.5h). Return your answer ONLY by calling',
  'the emit_plan tool.',
].join('\n')

export interface ScheduleConfig {
  location?: string
  weekday?: Record<string, unknown>
  weekend?: { saturday?: Record<string, unknown>; sunday?: Record<string, unknown> }
  running?: Record<string, unknown>
}

// Builds the schedule/availability context from the user's stored config (loose jsonb). Mirrors
// the original's weekday/weekend/Sunday branches; tolerant of missing fields.
function scheduleContext(dayOfWeek: string, schedule: ScheduleConfig | null): string {
  if (!schedule) return ''
  const isSaturday = dayOfWeek === 'Saturday'
  const isSunday = dayOfWeek === 'Sunday'
  const lines: string[] = []

  if (isSaturday || isSunday) {
    const ds = (isSunday ? schedule.weekend?.sunday : schedule.weekend?.saturday) ?? {}
    const freeHours = (ds.freeTimeEstimateHours as number) ?? 8
    lines.push(`Today is a ${dayOfWeek} — ${(ds.notes as string) ?? 'generally a free day'}.`)
    lines.push(`Estimated free time: ~${freeHours}h. Bigger projects and outings are fair game.`)
    if (isSunday && ds.longRunWindow) {
      lines.push(`Note: the long run is ~${ds.longRunWindow} — those hours are unavailable.`)
    }
  } else {
    const wd = schedule.weekday ?? {}
    const freeHours = (wd.freeTimeEstimateHours as number) ?? 4.5
    lines.push(`Today is a ${dayOfWeek} (weekday).`)
    if (wd.workStart && wd.workEnd) lines.push(`Work hours: ${wd.workStart}–${wd.workEnd}.`)
    lines.push('Personal time slots:')
    lines.push('  • morning — before work (usually a run; very little task time)')
    lines.push('  • lunch — midday (~1–2h, usable for an errand or quick task)')
    lines.push('  • afternoon — ~5–7pm (the main productive window, ~2h)')
    lines.push('  • evening — ~7–10:30pm (wind-down; light tasks only)')
    lines.push(`Total personal time today: ~${freeHours}h.`)
  }
  if (schedule.running?.race) {
    lines.push(
      `Context: the user is marathon training (${schedule.running.race}). Runs are non-negotiable` +
        ' like work — ignore them when planning and never suggest running as a task.',
    )
  }
  return lines.join('\n')
}

function taskLines(req: PlanRequest): string {
  if (req.tasks.length === 0) return '(no tasks placed on the grid)'
  return req.tasks
    .map((t) => {
      const due =
        t.due == null
          ? 'no due date'
          : t.dueInDays != null && t.dueInDays < 0
            ? `due ${Math.abs(t.dueInDays)}d ago`
            : t.dueInDays === 0
              ? 'due today'
              : `due in ${t.dueInDays}d`
      return `- ${t.text} (importance ${Math.round(t.importance)}, urgency ${Math.round(
        t.urgency,
      )}, ${due})`
    })
    .join('\n')
}

// The day's data as the user message. The persona + rules live in SYSTEM_PROMPT.
export function buildUserPrompt(
  req: PlanRequest,
  schedule: ScheduleConfig | null,
  weather: string | null,
): string {
  const sched = scheduleContext(req.dayOfWeek, schedule)
  const blocks: string[] = [`Today is ${req.today}.`]
  if (sched) blocks.push(`=== SCHEDULE & AVAILABILITY ===\n${sched}`)
  if (weather) {
    blocks.push(
      `=== WEATHER ===\n${weather}` +
        (req.dayOfWeek === 'Saturday' || req.dayOfWeek === 'Sunday'
          ? '\nIf it is nice out, lean toward outdoor tasks or activities.'
          : ''),
    )
  }
  blocks.push(
    `=== ACTIVE HABITS (acknowledge in habitNote) ===\n${
      req.habits.length ? req.habits.map((h) => `- ${h}`).join('\n') : '(none active)'
    }`,
  )
  if (req.recurringDue.length) {
    blocks.push(
      `=== RECURRING CHORES DUE ===\n${req.recurringDue
        .map((r) => `- ${r.text} (${r.status})`)
        .join('\n')}`,
    )
  }
  blocks.push(`=== TASKS ON THE GRID ===\n(importance 0–100, urgency 0–100)\n${taskLines(req)}`)
  return blocks.join('\n\n')
}
