// Run: deno test --no-check supabase/functions/_shared/reminder-content.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import {
  buildReminderContent,
  formatCadence,
  formatClockTime,
  formatOffset,
} from './reminder-content.ts'

Deno.test('formatClockTime: wire HH:MM:SS → 12-hour clock, no timezone math', () => {
  assertEquals(formatClockTime('15:00:00'), '3:00 PM')
  assertEquals(formatClockTime('10:30:00'), '10:30 AM')
  assertEquals(formatClockTime('00:05:00'), '12:05 AM')
  assertEquals(formatClockTime('12:00:00'), '12:00 PM')
  assertEquals(formatClockTime('garbage'), 'garbage') // defensive passthrough
})

Deno.test('formatOffset: minutes / hours / days / mixed', () => {
  assertEquals(formatOffset(10), '10 minutes')
  assertEquals(formatOffset(1), '1 minute')
  assertEquals(formatOffset(60), '1 hour')
  assertEquals(formatOffset(120), '2 hours')
  assertEquals(formatOffset(90), '1h 30m')
  assertEquals(formatOffset(1440), '1 day')
  assertEquals(formatOffset(2880), '2 days')
})

Deno.test('formatCadence: daily / weekly / every-N / fallback', () => {
  assertEquals(formatCadence(1), 'Every day')
  assertEquals(formatCadence(7), 'Every week')
  assertEquals(formatCadence(3), 'Every 3 days')
  assertEquals(formatCadence(null), 'Recurring')
})

Deno.test('buildReminderContent: title carries the task, body says when', () => {
  assertEquals(
    buildReminderContent({
      task_text: 'Dentist appointment',
      due_time: '10:30:00',
      offset_minutes: 60,
    }),
    { title: '⏰ Dentist appointment', body: 'Due in 1 hour — 10:30 AM' },
  )
  assertEquals(
    buildReminderContent({ task_text: 'Team meeting', due_time: '15:00:00', offset_minutes: 0 }),
    { title: '⏰ Team meeting', body: 'Due now — 3:00 PM' },
  )
})

Deno.test('buildReminderContent: recurring (offset null) → fixed-cadence alarm copy', () => {
  assertEquals(
    buildReminderContent({
      task_text: 'Take pill',
      due_time: null,
      offset_minutes: null,
      time_of_day: '12:00:00',
      frequency_days: 1,
    }),
    { title: '⏰ Take pill', body: 'Every day — 12:00 PM' },
  )
  assertEquals(
    buildReminderContent({
      task_text: 'Water plants',
      due_time: null,
      offset_minutes: null,
      time_of_day: '09:00:00',
      frequency_days: 7,
    }),
    { title: '⏰ Water plants', body: 'Every week — 9:00 AM' },
  )
})
