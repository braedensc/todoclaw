// Deno unit tests for the Plan My Day prompt builder + payload schema.
// Run: deno test --no-check supabase/functions/_shared/plan-prompt.test.ts
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  PlanRequestSchema,
  buildUserPrompt,
  type PlanRequest,
  type ScheduleConfig,
} from './plan-prompt.ts'

const base: PlanRequest = {
  today: 'Wednesday, June 24, 2026',
  dayOfWeek: 'Wednesday',
  tasks: [
    { text: 'File taxes', importance: 80, urgency: 90, due: '2026-06-25', dueInDays: 1 },
    { text: 'Read paper', importance: 30, urgency: 10, due: null, dueInDays: null },
    { text: 'Renew passport', importance: 70, urgency: 20, due: '2026-06-20', dueInDays: -4 },
  ],
  recurringDue: [{ text: 'Water plants', status: 'due today' }],
  habits: ['Stretch', 'Read 10 pages'],
}

const schedule: ScheduleConfig = {
  location: 'Atlanta, GA',
  weekday: { workStart: '9:30', workEnd: '17:00', freeTimeEstimateHours: 4.5 },
  weekend: {
    sunday: {
      notes: 'free after the run',
      longRunWindow: '8:30am–12:00pm',
      freeTimeEstimateHours: 7,
    },
    saturday: { notes: 'mostly free', freeTimeEstimateHours: 9 },
  },
  running: { race: 'MDI Marathon' },
}

Deno.test('PlanRequestSchema accepts a valid payload and rejects a malformed one', () => {
  assertEquals(PlanRequestSchema.parse(base).dayOfWeek, 'Wednesday')
  assertThrows(() => PlanRequestSchema.parse({ today: 'x' }))
})

Deno.test('weekday prompt: slots + free-time + running guard + habits + tasks', () => {
  const p = buildUserPrompt(base, schedule, null)
  assert(p.includes('(weekday)'))
  assert(p.includes('Work hours: 9:30–17:00'))
  assert(p.includes('~4.5h'))
  assert(p.includes('marathon training'))
  assert(p.includes('Stretch'))
  assert(p.includes('Water plants (due today)'))
  // task line formatting: overdue, due-in-N, no-due
  assert(p.includes('due 4d ago'))
  assert(p.includes('due in 1d'))
  assert(p.includes('no due date'))
})

Deno.test('Sunday prompt mentions the long-run window; Saturday does not', () => {
  const sun = buildUserPrompt({ ...base, dayOfWeek: 'Sunday' }, schedule, null)
  assert(sun.includes('Sunday'))
  assert(sun.includes('long run'))
  const sat = buildUserPrompt({ ...base, dayOfWeek: 'Saturday' }, schedule, null)
  assert(sat.includes('Saturday'))
  assert(!sat.includes('long run'))
})

Deno.test('weather block appears only when weather is provided', () => {
  assert(!buildUserPrompt(base, schedule, null).includes('=== WEATHER ==='))
  assert(buildUserPrompt(base, schedule, 'Sunny, 75°F').includes('Sunny, 75°F'))
})

Deno.test('empty grid + no habits is stated, not blank', () => {
  const p = buildUserPrompt({ ...base, tasks: [], habits: [], recurringDue: [] }, null, null)
  assert(p.includes('(no tasks placed on the grid)'))
  assert(p.includes('(none active)'))
})
