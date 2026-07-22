// limits-reference.ts — the read-only "Limits" tab data for the owner Admin panel.
//
// A curated, grouped snapshot of every meaningful limit / cap / guardrail in the app, for the owner
// to eyeball what's in effect without diving into code. This is REFERENCE content (non-secret
// constants), not live state: the owner-tunable AI caps show their LIVE values in the Guardrails tab;
// everything here is a fixed constant unless marked `tunable`. Keep in sync with docs/LIMITS.md — that
// doc is the source of truth and cites the exact file + constant for each row.

export type LimitKind = 'tunable' | 'fixed'

export interface LimitRow {
  name: string
  value: string
  /** per user | global | per IP | per request | per call | per session — omit for boundary rows. */
  scope?: string
  /** Badge: owner-tunable (in Guardrails) vs a fixed constant. Omit on non-numeric boundary rows. */
  kind?: LimitKind
}

export interface LimitGroup {
  id: string
  title: string
  hint?: string
  rows: LimitRow[]
  /** Expanded on first render (the two most-referenced groups). */
  defaultOpen?: boolean
}

export const LIMIT_GROUPS: LimitGroup[] = [
  {
    id: 'rate',
    title: 'AI rate limits',
    hint: 'Per-user request counts. Chat & Plan are owner-tunable in the Guardrails tab (ceilings 200/2000 · 50/50); the total backstop is fixed.',
    defaultOpen: true,
    rows: [
      { name: 'Chat', value: '30/hr · 100/day', scope: 'per user', kind: 'tunable' },
      { name: 'Plan My Day', value: '10/hr · 10/day', scope: 'per user', kind: 'tunable' },
      { name: 'Total AI backstop', value: '4000 requests/day', scope: 'per user', kind: 'fixed' },
    ],
  },
  {
    id: 'spend',
    title: 'AI spend / budget',
    hint: 'Cost kill-switches. Global + per-user caps are owner-tunable in the Guardrails tab.',
    defaultOpen: true,
    rows: [
      { name: 'Global monthly pool', value: '$20/mo (≤ $100)', scope: 'global', kind: 'tunable' },
      { name: 'Per-user monthly cap', value: '$10/mo (≤ $50)', scope: 'per user', kind: 'tunable' },
      { name: 'Per-call spend ceiling', value: '$0.20', scope: 'per call', kind: 'fixed' },
      { name: 'Owner spend alert', value: '80% of per-user cap', scope: 'per user', kind: 'fixed' },
      { name: 'Output tokens', value: '2048 / call', scope: 'per call', kind: 'fixed' },
      { name: 'Token cost basis', value: '$3 in · $15 out / 1M', scope: 'per call', kind: 'fixed' },
    ],
  },
  {
    id: 'throttle',
    title: 'Per-IP throttles',
    hint: 'Coarse pre-auth flood guards. Fail open (allow on error) — except redeem-invite, which fails closed.',
    rows: [
      { name: 'AI status', value: '300 / 60s', scope: 'per IP', kind: 'fixed' },
      { name: 'AI chat', value: '240 / 60s', scope: 'per IP', kind: 'fixed' },
      { name: 'Plan My Day', value: '120 / 60s', scope: 'per IP', kind: 'fixed' },
      { name: 'Admin', value: '120 / 60s', scope: 'per IP', kind: 'fixed' },
      { name: 'Generate invite', value: '60 / 60s', scope: 'per IP', kind: 'fixed' },
      { name: 'Redeem invite', value: '10 / 10 min', scope: 'per IP', kind: 'fixed' },
      {
        name: 'Resolve location',
        value: '20/hr · 60/day (no IP cap)',
        scope: 'per user',
        kind: 'fixed',
      },
    ],
  },
  {
    id: 'storage',
    title: 'Storage caps (per user)',
    hint: 'Row-count caps enforced by database triggers so one account can’t balloon storage.',
    rows: [
      { name: 'Tasks', value: '2000 live · 10000 total', scope: 'per user', kind: 'fixed' },
      { name: 'Habits', value: '200 live · 1000 total', scope: 'per user', kind: 'fixed' },
      { name: 'Completion history', value: '10000', scope: 'per user', kind: 'fixed' },
      { name: 'Reminders', value: '8 / task · 2000 / user', scope: 'per user', kind: 'fixed' },
      { name: 'Push subscriptions', value: '20', scope: 'per user', kind: 'fixed' },
      { name: 'Backups', value: '15', scope: 'per user', kind: 'fixed' },
      { name: 'Chat sessions', value: '100', scope: 'per user', kind: 'fixed' },
      { name: 'Chat messages', value: '2000 / session', scope: 'per session', kind: 'fixed' },
      { name: 'Saved memories', value: '30', scope: 'per user', kind: 'fixed' },
      { name: 'Daily state', value: '±14-day window', scope: 'per user', kind: 'fixed' },
    ],
  },
  {
    id: 'input',
    title: 'Input / size caps',
    hint: 'Bounds on what a single request can carry (Zod + database CHECK).',
    rows: [
      { name: 'Password', value: '8–128 chars', scope: 'per request', kind: 'fixed' },
      { name: 'Invite code', value: '≤ 64 chars', scope: 'per request', kind: 'fixed' },
      { name: 'Task / habit text', value: '2000 chars', scope: 'per row', kind: 'fixed' },
      { name: 'Chat message', value: '4000 chars', scope: 'per request', kind: 'fixed' },
      { name: 'Saved memory', value: '240 chars', scope: 'per row', kind: 'fixed' },
      { name: 'Location', value: '120 chars', scope: 'per row', kind: 'fixed' },
      { name: 'Plan notes / instructions', value: '500 chars', scope: 'per row', kind: 'fixed' },
      { name: 'Tool steps per chat turn', value: '8', scope: 'per request', kind: 'fixed' },
      { name: 'Memory writes per chat turn', value: '2', scope: 'per request', kind: 'fixed' },
      {
        name: 'Chat replay window',
        value: '60 msgs / 50k chars',
        scope: 'per request',
        kind: 'fixed',
      },
      { name: 'Plan My Day payload', value: '≤ 200 tasks', scope: 'per request', kind: 'fixed' },
    ],
  },
  {
    id: 'delivery',
    title: 'Notifications & delivery',
    hint: 'Bounds on the web-push / reminder / digest pipeline.',
    rows: [
      { name: 'Web-push send timeout', value: '10s / endpoint', scope: 'per call', kind: 'fixed' },
      {
        name: 'Push endpoint allowlist',
        value: '4 real push services (SSRF guard)',
        scope: 'per call',
        kind: 'fixed',
      },
      {
        name: 'Reminder sweep batch',
        value: '500 / run (≤ 2000)',
        scope: 'per run',
        kind: 'fixed',
      },
      { name: 'Reminder run deadline', value: '50s', scope: 'per run', kind: 'fixed' },
      { name: 'Reminder freshness window', value: '60 min', scope: 'per reminder', kind: 'fixed' },
      { name: 'Push payload max', value: '≈ 3.9 KB', scope: 'per call', kind: 'fixed' },
      { name: 'Digest push body', value: '1800 chars', scope: 'per message', kind: 'fixed' },
      { name: 'VAPID token TTL', value: '12h', scope: 'per token', kind: 'fixed' },
      { name: 'Push message TTL', value: '28 days', scope: 'per call', kind: 'fixed' },
      {
        name: 'Dispatch cadence',
        value: 'every minute (self-gates to local hour)',
        scope: 'system',
        kind: 'fixed',
      },
      { name: 'Weather cache', value: '30 min', scope: 'global', kind: 'fixed' },
    ],
  },
  {
    id: 'access',
    title: 'Access & auth model',
    hint: 'Who can reach what — the shape of the guard, not a number.',
    rows: [
      { name: 'Public signup', value: 'off — invite-only' },
      { name: 'Every table', value: 'RLS, owner-scoped (you see only your own rows)' },
      { name: 'AI & status endpoints', value: 'login required' },
      { name: 'Admin & invite minting', value: 'owner-only' },
      { name: 'Cron dispatchers', value: 'shared-secret gated' },
      { name: 'Ledgers / throttle logs', value: 'no direct access — server-only (DEFINER RPCs)' },
    ],
  },
]
