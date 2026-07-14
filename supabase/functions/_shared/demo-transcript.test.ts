// Drift guard for the onboarding demo's canned check-ins (src/features/onboarding/demo-transcript.ts).
// The DemoScene shows a scripted morning plan push + evening recap; those strings are committed as
// constants on the frontend because the dispatch builders are Deno-only. This test re-runs the REAL
// builders over the same fixtures and asserts the committed strings still match — so a wording or
// format change in dispatch.ts fails CI here instead of silently making the demo lie about what the
// app actually sends. On failure: re-run the builders over the fixtures and paste the new output
// into DEMO_MORNING / DEMO_RECAP.
import { assertEquals } from 'jsr:@std/assert@1'
import { buildMorningFromPlan, buildRecapMessage } from './dispatch.ts'
import {
  DEMO_EVENING_INPUTS,
  DEMO_MORNING,
  DEMO_MORNING_INPUTS,
  DEMO_PLAN,
  DEMO_RECAP,
  DEMO_TRANSCRIPT_DATE,
  DEMO_TRANSCRIPT_DAY,
  DEMO_TRANSCRIPT_TZ,
} from '../../../src/features/onboarding/demo-transcript.ts'

Deno.test('demo morning check-in matches buildMorningFromPlan output', () => {
  const built = buildMorningFromPlan(DEMO_PLAN, DEMO_MORNING_INPUTS, DEMO_TRANSCRIPT_DATE)
  assertEquals(built.title, DEMO_MORNING.title)
  assertEquals(built.body, DEMO_MORNING.body)
})

Deno.test('demo evening recap matches buildRecapMessage output', () => {
  const built = buildRecapMessage(DEMO_EVENING_INPUTS, {
    dayName: DEMO_TRANSCRIPT_DAY,
    timeZone: DEMO_TRANSCRIPT_TZ,
    localDate: DEMO_TRANSCRIPT_DATE,
  })
  assertEquals(built.title, DEMO_RECAP.title)
  assertEquals(built.body, DEMO_RECAP.body)
})

// The fixed transcript day name must agree with the fixed date (the recap title embeds it).
Deno.test('transcript day name agrees with the transcript date', () => {
  const day = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: DEMO_TRANSCRIPT_TZ,
  }).format(new Date(`${DEMO_TRANSCRIPT_DATE}T12:00:00Z`))
  assertEquals(day, DEMO_TRANSCRIPT_DAY)
})
