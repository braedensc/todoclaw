// dispatch-messages — the hourly proactive dispatcher (ADR-0031). Invoked by .github/workflows/
// notify.yml with the shared DISPATCH_SECRET header (nothing else may trigger it). For every user
// whose LOCAL hour matches their morning/evening pref (and isn't in quiet hours), it atomically
// claims today's message (the row insert is the send lock — idempotent across overlapping/retried
// runs), generates the morning plan into daily_state when the budget allows, and pushes the
// notification to their subscriptions. It runs entirely on the service-role admin client (no user
// JWT) via the *_for_user / DEFINER RPCs, so proactive AI spends against the same budgets as
// interactive AI. Every user is wrapped in try/catch so one failure never aborts the batch.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { adminClient } from '../_shared/admin.ts'
import { anthropic } from '../_shared/anthropic.ts'
import { precheckForUser, recordUsageForUser } from '../_shared/guardrails-system.ts'
import { generatePlan } from '../_shared/run-plan.ts'
import { buildPlanRequest } from '../_shared/plan-inputs.ts'
import { localDateInTZ } from '../_shared/dates.ts'
import {
  buildMorningFromPlan,
  buildMorningMessage,
  buildRecapMessage,
  dayNameInTZ,
  dueKind,
  localHourInTZ,
  type DispatchInputs,
  type DispatchPlan,
  type MessageContent,
  type NotificationPrefs,
} from '../_shared/dispatch.ts'
import { sendWebPush, type PushSubscription, type VapidKeys } from '../_shared/web-push.ts'
import type { ScheduleConfig } from '../_shared/plan-prompt.ts'

const EMPTY_INPUTS: DispatchInputs = {
  config: null,
  tasks: [],
  habits: [],
  done: {},
  habit_done: {},
  plan: null,
}

// VAPID keys are server-only secrets. Unset ⇒ push is skipped but messages still persist (the inbox
// is the source of truth); dev/CI without the secrets are unaffected.
function vapidFromEnv(): VapidKeys | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

interface Candidate {
  user_id: string
  timezone: string
  notifications: NotificationPrefs | null
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

  const { data: candidates, error } = await admin.rpc('notification_candidates')
  if (error) {
    console.error('notification_candidates failed:', error)
    return json({ error: 'candidates_failed' }, 500)
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const c of (candidates ?? []) as Candidate[]) {
    try {
      const kind = dueKind(c.notifications ?? {}, localHourInTZ(c.timezone, now))
      if (!kind) continue

      const localDate = localDateInTZ(c.timezone, now)
      const { data: inputsJson } = await admin.rpc('dispatch_inputs_for_user', {
        p_user_id: c.user_id,
        p_local_date: localDate,
      })
      const inputs = (inputsJson ?? EMPTY_INPUTS) as DispatchInputs

      // Initial content. Morning with a plan already on file (user planned early, or a prior partial
      // run generated it) formats the real plan immediately; otherwise the deterministic message —
      // upgraded below if generation succeeds. Evening builds its check-in from the morning's plan.
      let content: MessageContent =
        kind === 'plan'
          ? inputs.plan
            ? buildMorningFromPlan(inputs.plan, inputs)
            : buildMorningMessage(inputs)
          : buildRecapMessage(inputs, dayNameInTZ(c.timezone, now))

      // The atomic claim: null ⇒ this (user, day, kind) already went out ⇒ skip (no double-send).
      // Claiming BEFORE any AI spend keeps overlapping runs from double-charging the budget.
      const { data: msgId } = await admin.rpc('claim_message', {
        p_user_id: c.user_id,
        p_kind: kind,
        p_local_date: localDate,
        p_title: content.title,
        p_body: content.body,
        p_data: null,
      })
      if (!msgId) {
        skipped++
        continue
      }

      // Morning without a plan yet: generate it (budget-gated) into daily_state, then upgrade the
      // claimed message to the plan-rich body before pushing. A paused budget or failed generation
      // leaves the deterministic message in place — the send never depends on the model.
      if (kind === 'plan' && !inputs.plan) {
        const plan = await maybeGeneratePlan(admin, c.user_id, c.timezone, inputs, localDate, now)
        if (plan) {
          content = buildMorningFromPlan(plan, inputs)
          await admin.rpc('enrich_message', {
            p_id: msgId,
            p_title: content.title,
            p_body: content.body,
          })
        }
      }

      if (vapid) await pushToUser(admin, c.user_id, String(msgId), content, vapid)
      sent++
    } catch (e) {
      failed++
      console.error('dispatch failed for user', c.user_id, e)
    }
  }

  return json({ candidates: (candidates ?? []).length, sent, skipped, failed })
})

// Generate + persist the morning plan for one user, gated by the same budget/rate limits as
// interactive Plan My Day (keyed on the user id). Returns the plan so the caller can upgrade the
// notification body; null on any failure (the deterministic message stands). No weather — the
// cached-weather RPCs are auth.uid()-scoped (system can't read).
async function maybeGeneratePlan(
  admin: SupabaseClient,
  userId: string,
  timeZone: string,
  inputs: DispatchInputs,
  localDate: string,
  now: Date,
): Promise<DispatchPlan | null> {
  const gate = await precheckForUser(admin, userId, 'plan_my_day')
  if (!gate.ok) return null
  try {
    const req = buildPlanRequest(inputs.tasks, inputs.habits, inputs.done, timeZone, now)
    const { plan, usage } = await generatePlan(
      anthropic(),
      req,
      (inputs.config ?? null) as ScheduleConfig | null,
      null,
    )
    await recordUsageForUser(admin, userId, usage.input, usage.output)
    await admin.rpc('save_daily_plan_for_user', {
      p_user_id: userId,
      p_date: localDate,
      p_plan: plan,
    })
    return plan as DispatchPlan
  } catch (e) {
    console.error('plan generation failed for', userId, e)
    return null
  }
}

// Push the notification to every subscription the user has; a subscription the push service reports
// gone (404/410) is pruned. The click deep-links into the in-app chat, seeded with the message.
async function pushToUser(
  admin: SupabaseClient,
  userId: string,
  messageId: string,
  content: MessageContent,
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
    } catch (e) {
      console.error('push failed for endpoint', s.endpoint, e)
    }
  }
}
