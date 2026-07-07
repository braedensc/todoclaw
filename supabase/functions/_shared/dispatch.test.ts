// Tests for the pure dispatcher logic (dispatch.ts): local-hour math, quiet-hours suppression, the
// due-kind decision, and the deterministic message content.
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  buildMorningMessage,
  buildRecapMessage,
  dueKind,
  isQuietHour,
  localHourInTZ,
  type DispatchInputs,
  type NotificationPrefs,
} from './dispatch.ts'

const noon_utc = new Date('2026-07-07T12:00:00Z')

Deno.test('localHourInTZ: same instant, different zones (DST-aware via Intl)', () => {
  assertEquals(localHourInTZ('America/New_York', noon_utc), 8) // UTC-4 in July
  assertEquals(localHourInTZ('America/Los_Angeles', noon_utc), 5) // UTC-7
  assertEquals(localHourInTZ('Asia/Tokyo', noon_utc), 21) // UTC+9
  assertEquals(localHourInTZ('UTC', noon_utc), 12)
})

Deno.test('localHourInTZ: midnight normalizes to 0', () => {
  assertEquals(localHourInTZ('UTC', new Date('2026-07-07T00:00:00Z')), 0)
})

Deno.test('isQuietHour: normal window [22,7) is exclusive at both computed ends', () => {
  const p: NotificationPrefs = { quietStartHour: 1, quietEndHour: 6 }
  assertEquals(isQuietHour(p, 0), false)
  assertEquals(isQuietHour(p, 1), true)
  assertEquals(isQuietHour(p, 5), true)
  assertEquals(isQuietHour(p, 6), false) // end exclusive
})

Deno.test('isQuietHour: window wrapping past midnight (22→7)', () => {
  const p: NotificationPrefs = { quietStartHour: 22, quietEndHour: 7 }
  assertEquals(isQuietHour(p, 23), true)
  assertEquals(isQuietHour(p, 3), true)
  assertEquals(isQuietHour(p, 7), false) // end exclusive
  assertEquals(isQuietHour(p, 12), false)
})

Deno.test('isQuietHour: unset or degenerate window is never quiet', () => {
  assertEquals(isQuietHour({}, 3), false)
  assertEquals(isQuietHour({ quietStartHour: 5, quietEndHour: 5 }, 5), false)
})

Deno.test('dueKind: matches morning/evening hours only when enabled', () => {
  const p: NotificationPrefs = { enabled: true, morningHour: 8, eveningHour: 21 }
  assertEquals(dueKind(p, 8), 'plan')
  assertEquals(dueKind(p, 21), 'recap')
  assertEquals(dueKind(p, 9), null)
  assertEquals(dueKind({ ...p, enabled: false }, 8), null)
  assertEquals(dueKind({ enabled: true }, 8), null) // no hours configured
})

Deno.test('dueKind: quiet hours suppress even a matching morning hour', () => {
  const p: NotificationPrefs = {
    enabled: true,
    morningHour: 6,
    eveningHour: 21,
    quietStartHour: 0,
    quietEndHour: 7, // 6am falls inside quiet → suppressed
  }
  assertEquals(dueKind(p, 6), null)
  assertEquals(dueKind(p, 21), 'recap') // evening is outside quiet
})

const inputs = (over: Partial<DispatchInputs> = {}): DispatchInputs => ({
  config: { location: 'Atlanta' },
  tasks: [
    { id: 'a', text: 'Alpha', x: 0.8, y: 0.9, due: null, staged: false, recurring: null },
    { id: 'b', text: 'Beta', x: 0.2, y: 0.3, due: null, staged: false, recurring: null },
    { id: 's', text: 'Staged', x: null, y: null, due: null, staged: true, recurring: null },
  ],
  habits: [
    { id: 'h1', text: 'Water', active: true },
    { id: 'h2', text: 'Old', active: false },
  ],
  done: {},
  habit_done: {},
  ...over,
})

Deno.test(
  'buildMorningMessage: counts placed, open, active — excludes staged/done/inactive',
  () => {
    const m = buildMorningMessage(inputs())
    assertEquals(m.title, 'Good morning ☀️')
    assertStringIncludes(m.body, '2 tasks and 1 habit on deck') // Alpha+Beta (not Staged), Water only
  },
)

Deno.test('buildMorningMessage: everything done/none placed → clear slate', () => {
  const m = buildMorningMessage(inputs({ done: { a: true, b: true }, habits: [] }))
  assertStringIncludes(m.body, 'a clear slate today')
})

Deno.test('buildRecapMessage: delegates to buildRecap over the done maps', () => {
  const m = buildRecapMessage(inputs({ done: { a: true }, habit_done: { h1: true } }))
  assertEquals(m.title, 'Your day, wrapped')
  assertStringIncludes(m.body, 'You finished 1 task: Alpha.')
  assertStringIncludes(m.body, 'Habits: Water.')
})
