// spend-alert.ts — a "this user is spending a lot" alert to the OWNER (not the user). It is the
// DETECTION companion to the budget kill-switch: the kill-switch BLOCKS a runaway account at its
// per-user cap, but silently — nothing tells the owner that a real account (or a leaked token /
// abuse) is burning through its slice. This fires a one-off webhook the first time a user's monthly
// spend crosses an alert threshold (USER_SPEND_ALERT_MICROS in guardrails.ts), so a spend anomaly is
// a SIGNAL, not just a wall the user quietly hits.
//
// Transport: a single POST to AI_SPEND_ALERT_WEBHOOK_URL — a SERVER-ONLY Edge Function secret, never
// in the client bundle (same posture as the Anthropic key). If it is UNSET this is a NO-OP, so local
// dev, CI, and any deploy without the secret are unaffected. The body sets both `text` and `content`
// to the same human line so a plain Slack OR Discord incoming webhook renders it with no extra
// config, and also carries structured fields for any other receiver (an email relay, a log sink…).

export interface SpendAlert {
  userId: string
  userEmail: string | null
  feature: string
  spentMicros: number
  capMicros: number
  thresholdMicros: number
  period: string // 'YYYY-MM' (UTC)
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`

export function formatSpendAlert(a: SpendAlert): string {
  const who = a.userEmail ? `${a.userEmail} (${a.userId})` : a.userId
  return (
    `⚠️ TodoClaw AI spend alert — user ${who} has spent ${usd(a.spentMicros)} on AI this month ` +
    `(${a.period}), crossing the ${usd(a.thresholdMicros)} alert threshold (per-user cap ` +
    `${usd(a.capMicros)}). Last call: ${a.feature}. If this is unexpected, investigate for misuse ` +
    `or a compromised account.`
  )
}

// Shape the POST body. `text` (Slack) and `content` (Discord) both hold the human message so either
// incoming-webhook flavor works untouched; the structured fields let any other receiver parse it.
export function buildAlertPayload(a: SpendAlert): Record<string, unknown> {
  const text = formatSpendAlert(a)
  return {
    text,
    content: text,
    event: 'ai_user_spend_alert',
    userId: a.userId,
    userEmail: a.userEmail,
    feature: a.feature,
    spentMicros: a.spentMicros,
    capMicros: a.capMicros,
    thresholdMicros: a.thresholdMicros,
    period: a.period,
  }
}

// Best-effort POST. Returns true only if the webhook is configured AND accepted the request; every
// failure path (unset URL, network error, non-2xx) is non-throwing/swallowed so an alerting hiccup
// can never fail the user's already-completed AI request. `fetchImpl` is injectable for tests.
export async function sendSpendAlert(
  alert: SpendAlert,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = Deno.env.get('AI_SPEND_ALERT_WEBHOOK_URL')
  if (!url) return false // not configured → no-op (local dev, CI, unset deploys)
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildAlertPayload(alert)),
  })
  return res.ok
}
