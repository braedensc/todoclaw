// Tests for the server-side default-reminder resolution. The constants here are the SAME values
// the client pins in src/features/reminders/reminder-offsets.test.ts — a drift in either copy
// fails one suite or the other.
// Run: deno test --no-check supabase/functions/_shared/reminder-default.test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import {
  REMINDER_DEFAULT_MINUTES,
  effectiveReminderDefault,
  loadReminderDefault,
} from './reminder-default.ts'

type Client = Parameters<typeof loadReminderDefault>[0]

function clientWithConfig(config: unknown): Client {
  return {
    from: () => ({
      select: () => ({
        maybeSingle: () => Promise.resolve({ data: config === undefined ? null : { config } }),
      }),
    }),
  } as unknown as Client
}

Deno.test('built-in default is 1 hour (pinned on both sides)', () => {
  assertEquals(REMINDER_DEFAULT_MINUTES, 60)
})

Deno.test('effectiveReminderDefault: undefined → 60, null → off, number → itself', () => {
  assertEquals(effectiveReminderDefault(undefined), 60)
  assertEquals(effectiveReminderDefault(null), null)
  assertEquals(effectiveReminderDefault(120), 120)
  assertEquals(effectiveReminderDefault(0), 0) // "at the due time" is a real choice, not off
})

Deno.test('loadReminderDefault reads config.notifications.reminderDefaultMinutes', async () => {
  assertEquals(
    await loadReminderDefault(clientWithConfig({ notifications: { reminderDefaultMinutes: 30 } })),
    30,
  )
  assertEquals(
    await loadReminderDefault(
      clientWithConfig({ notifications: { reminderDefaultMinutes: null } }),
    ),
    null, // user chose Off
  )
})

Deno.test(
  'loadReminderDefault: missing row / key / malformed value → built-in default',
  async () => {
    assertEquals(await loadReminderDefault(clientWithConfig(undefined)), 60) // no user_schedule row
    assertEquals(await loadReminderDefault(clientWithConfig(null)), 60) // null config
    assertEquals(await loadReminderDefault(clientWithConfig({})), 60) // no notifications key
    assertEquals(await loadReminderDefault(clientWithConfig({ notifications: 'weird' })), 60)
    assertEquals(
      await loadReminderDefault(
        clientWithConfig({ notifications: { reminderDefaultMinutes: 'soon' } }),
      ),
      60,
    )
    assertEquals(
      await loadReminderDefault(
        clientWithConfig({ notifications: { reminderDefaultMinutes: -5 } }),
      ),
      60,
    )
  },
)

Deno.test(
  'an ERRORED config read fails toward Off — never writes against an explicit Off',
  async () => {
    const erroring = {
      from: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }),
      }),
    } as unknown as Client
    assertEquals(await loadReminderDefault(erroring), null)
  },
)
