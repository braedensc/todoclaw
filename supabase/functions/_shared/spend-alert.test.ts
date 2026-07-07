// Deno unit tests for the owner spend-alert transport (pure formatting + the env-gated no-op).
// Run: deno test --allow-env --no-check supabase/functions/_shared/
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  buildAlertPayload,
  formatSpendAlert,
  sendSpendAlert,
  type SpendAlert,
} from './spend-alert.ts'

const SAMPLE: SpendAlert = {
  userId: 'u-123',
  userEmail: 'heavy@example.com',
  feature: 'chat',
  spentMicros: 8_120_000,
  capMicros: 10_000_000,
  thresholdMicros: 8_000_000,
  period: '2026-07',
}

Deno.test('formatSpendAlert renders dollars, the user, cap, threshold, and period', () => {
  const msg = formatSpendAlert(SAMPLE)
  assertStringIncludes(msg, '$8.12') // spent
  assertStringIncludes(msg, '$8.00') // threshold
  assertStringIncludes(msg, '$10.00') // cap
  assertStringIncludes(msg, 'heavy@example.com')
  assertStringIncludes(msg, 'u-123')
  assertStringIncludes(msg, '2026-07')
})

Deno.test('formatSpendAlert falls back to the id when there is no email', () => {
  const msg = formatSpendAlert({ ...SAMPLE, userEmail: null })
  assertStringIncludes(msg, 'u-123')
})

Deno.test('buildAlertPayload sets both text (Slack) and content (Discord) to the message', () => {
  const p = buildAlertPayload(SAMPLE)
  assertEquals(p.text, p.content)
  assertEquals(typeof p.text, 'string')
  assertEquals(p.event, 'ai_user_spend_alert')
  assertEquals(p.userId, 'u-123')
  assertEquals(p.spentMicros, 8_120_000)
  assertEquals(p.period, '2026-07')
})

Deno.test('sendSpendAlert is a NO-OP (no fetch) when the webhook URL is unset', async () => {
  Deno.env.delete('AI_SPEND_ALERT_WEBHOOK_URL')
  let called = false
  const fakeFetch = (() => {
    called = true
    return Promise.resolve(new Response(null, { status: 200 }))
  }) as unknown as typeof fetch
  const sent = await sendSpendAlert(SAMPLE, fakeFetch)
  assertEquals(sent, false)
  assertEquals(called, false)
})

Deno.test('sendSpendAlert POSTs the JSON payload to the configured URL', async () => {
  Deno.env.set('AI_SPEND_ALERT_WEBHOOK_URL', 'https://hooks.example.com/xyz')
  try {
    let seenUrl = ''
    let seenMethod = ''
    let seenBody: Record<string, unknown> = {}
    const fakeFetch = ((url: string, init: RequestInit) => {
      seenUrl = url
      seenMethod = init.method ?? ''
      seenBody = JSON.parse(init.body as string)
      return Promise.resolve(new Response(null, { status: 204 }))
    }) as unknown as typeof fetch
    const sent = await sendSpendAlert(SAMPLE, fakeFetch)
    assertEquals(sent, true)
    assertEquals(seenUrl, 'https://hooks.example.com/xyz')
    assertEquals(seenMethod, 'POST')
    assertEquals(seenBody.event, 'ai_user_spend_alert')
    assertEquals(seenBody.text, seenBody.content)
  } finally {
    Deno.env.delete('AI_SPEND_ALERT_WEBHOOK_URL')
  }
})
