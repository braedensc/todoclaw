// dispatch-reminders — the per-task reminder sweep (ADR 2026-07-09; recurring 2026-07-11). Invoked
// EVERY MINUTE by the pg_cron job (20260709033335_task_reminders_pipeline.sql) with the shared
// DISPATCH_SECRET header — same gate as dispatch-messages, nothing else may trigger it. It expires
// stale reminders (one-off rows retire, recurring rows advance), reads the fresh due ones
// (due_task_reminders excludes deleted tasks and one-off done-today tasks; recurring rows fire on a
// fixed cadence regardless of completion), claims each row exactly-once (for a one-off the sent_at
// UPDATE is the send lock; for a recurring row the claim ADVANCES fire_at to the next occurrence and
// that advance IS the lock — an overlapping run re-reads the future fire_at and skips), records the
// durable inbox row, and pushes to every subscription. Content is deterministic (reminder-content.ts):
// zero AI tokens, no budget calls. Every reminder is wrapped in try/catch so one failure never
// aborts the batch.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { adminClient } from '../_shared/admin.ts'
import { localDateInTZ } from '../_shared/dates.ts'
import { buildReminderContent, type ReminderContent } from '../_shared/reminder-content.ts'
import { sendWebPush, type PushSubscription, type VapidKeys } from '../_shared/web-push.ts'

// VAPID keys are server-only secrets. Unset ⇒ push is skipped but the inbox row still lands
// (the messages table is the source of truth); dev/CI without the secrets are unaffected.
function vapidFromEnv(): VapidKeys | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

interface DueReminder {
  id: string
  user_id: string
  task_id: string
  task_text: string
  due: string | null
  due_time: string | null
  timezone: string
  offset_minutes: number
}

Deno.serve(async (req) => {
  // The only gate: the shared secret. verify_jwt is off (config.toml) because there is no user JWT.
  const secret = Deno.env.get('DISPATCH_SECRET')
  const provided = req.headers.get('x-dispatch-secret')
  if (!secret || provided !== secret) return new Response('forbidden', { status: 403 })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const admin = adminClient()
  const now = new Date()
  const vapid = vapidFromEnv()

  // Retire anything the sweep missed by more than the freshness window (cron outage): an
  // hour-late "reminder" is noise, not help.
  const { data: expired, error: expireError } = await admin.rpc('expire_stale_reminders')
  if (expireError) console.error('expire_stale_reminders failed:', expireError)

  const { data: dueRows, error } = await admin.rpc('due_task_reminders')
  if (error) {
    console.error('due_task_reminders failed:', error)
    return json({ error: 'due_reminders_failed' }, 500)
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const r of (dueRows ?? []) as DueReminder[]) {
    try {
      // The exactly-once claim — null ⇒ another (overlapping) run already took this one.
      const { data: claimed } = await admin.rpc('claim_task_reminder', { p_id: r.id })
      if (!claimed) {
        skipped++
        continue
      }

      const content = buildReminderContent(r)
      const { data: msgId, error: msgError } = await admin.rpc('insert_reminder_message', {
        p_user_id: r.user_id,
        p_local_date: localDateInTZ(r.timezone, now),
        p_title: content.title,
        p_body: content.body,
        p_data: { task_id: r.task_id },
      })
      if (msgError) throw msgError

      if (vapid) await pushToUser(admin, r.user_id, String(msgId), content, vapid)
      sent++
    } catch (e) {
      failed++
      console.error('reminder dispatch failed for', r.id, e)
    }
  }

  return json({ due: (dueRows ?? []).length, sent, skipped, failed, expired: expired ?? 0 })
})

// Push to every subscription the user has; a subscription the push service reports gone
// (404/410) is pruned. Same shape as dispatch-messages' pushToUser (deliberately duplicated —
// two small copies over a premature abstraction); the tap deep-links into the in-app chat,
// seeded with the reminder message.
async function pushToUser(
  admin: SupabaseClient,
  userId: string,
  messageId: string,
  content: ReminderContent,
  vapid: VapidKeys,
): Promise<void> {
  const { data: subs } = await admin.rpc('push_subscriptions_for_user', { p_user_id: userId })
  const payload = JSON.stringify({
    title: content.title,
    body: content.body,
    tag: messageId,
    url: `/#/chat/${messageId}`,
  })
  for (const s of (subs ?? []) as { endpoint: string; p256dh: string; auth: string }[]) {
    const subscription: PushSubscription = {
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    }
    try {
      const res = await sendWebPush(subscription, payload, vapid)
      if (res.gone) await admin.rpc('prune_push_subscription', { p_endpoint: s.endpoint })
      else if (!res.ok) console.error('push rejected for endpoint', s.endpoint, 'HTTP', res.status)
    } catch (e) {
      console.error('push failed for endpoint', s.endpoint, e)
    }
  }
}
