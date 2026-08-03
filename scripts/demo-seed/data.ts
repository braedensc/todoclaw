// Checked-in demo dataset for the local demo seed (npm run seed:demo) and the demo-seed golden
// E2E spec. Entirely fictional sample content — no personal data. Shaped for the current schema,
// so scripts/demo-seed/insert.ts writes it verbatim (no legacy mapping).
//
// Coverage the demo-seed golden spec asserts against, so keep them in sync if you edit this:
//   • 8 unstaged, not-done tasks  → 8 active List rows
//   • "Water the plants"          → a recurring task, overdue (lastDoneAt far in the past) → ↻ badge
//   • "Frame the trail photos"    → one permanent Done/history entry
//   • "Morning stretch routine" + "Read before bed" → habits with subtasks on the Reminders page

import type { SeedState } from './types'

// A fixed pre-tracking date so seeded rows sort as "older" and the staleness/dust rendering has
// aged cards to show. Kept off `now()` on purpose (determinism, and so nothing reads as brand-new).
const CREATED_AT = '2026-05-01T00:00:00.000Z'

export const DEMO_STATE: SeedState = {
  tasks: [
    // urgent + important — top-right "do it now" corner
    {
      text: 'Submit the quarterly report',
      x: 0.85,
      y: 0.88,
      due: '2026-07-18',
      staged: false,
      bucket: 'oneoff',
      recurring: null,
      created_at: CREATED_AT,
    },
    {
      text: 'Book the dentist appointment',
      x: 0.72,
      y: 0.34,
      due: '2026-07-20',
      staged: false,
      bucket: 'oneoff',
      recurring: null,
      created_at: CREATED_AT,
    },
    {
      text: 'Buy groceries for the week',
      x: 0.66,
      y: 0.42,
      due: null,
      staged: false,
      bucket: 'oneoff',
      recurring: null,
      created_at: CREATED_AT,
    },
    // recurring chore, overdue since lastDoneAt is far in the past → ↻ badge always shows
    {
      text: 'Water the plants',
      x: 0.3,
      y: 0.5,
      due: null,
      staged: false,
      bucket: 'oneoff',
      recurring: { frequencyDays: 2, lastDoneAt: '2026-01-05T09:00:00.000Z', doneCount: 4 },
      created_at: CREATED_AT,
    },
    {
      text: 'Plan the weekend hike',
      x: 0.38,
      y: 0.7,
      due: null,
      staged: false,
      bucket: 'oneoff',
      recurring: null,
      created_at: CREATED_AT,
    },
    {
      text: "Reply to Sam's email",
      x: 0.78,
      y: 0.55,
      due: null,
      staged: false,
      bucket: 'oneoff',
      recurring: null,
      created_at: CREATED_AT,
    },
    {
      text: 'Renew the library membership',
      x: 0.2,
      y: 0.36,
      due: null,
      staged: false,
      bucket: 'oneoff',
      recurring: null,
      created_at: CREATED_AT,
    },
    {
      text: 'Tidy the garage',
      x: 0.48,
      y: 0.22,
      due: null,
      staged: false,
      bucket: 'oneoff',
      recurring: null,
      created_at: CREATED_AT,
    },
  ],
  habits: [
    {
      text: 'Morning stretch routine',
      active: true,
      subtasks: [
        { id: 'sub-neck', text: 'Neck rolls' },
        { id: 'sub-hamstring', text: 'Hamstring stretch' },
      ],
    },
    { text: 'Drink water', active: true, subtasks: [] },
    {
      text: 'Read before bed',
      active: true,
      subtasks: [{ id: 'sub-pick-book', text: 'Pick tomorrow’s chapter' }],
    },
  ],
  history: [
    { text: 'Frame the trail photos', bucket: 'oneoff', completed_at: '2026-07-10T18:30:00.000Z' },
  ],
  schedule: {
    timezone: 'America/New_York',
    config: {
      location: 'Springfield',
      weekday: { wake: '07:00', sleep: '23:00' },
      weekend: { wake: '08:30', sleep: '23:30' },
    },
  },
}
