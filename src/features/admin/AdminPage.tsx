import type { ReactNode } from 'react'
import { goBack } from '../../lib/route'
import { useIsOwner } from '../auth/use-is-owner'
import { InviteManager } from '../settings/InviteManager'
import { useAdminOverview, formatUsd, type AdminOverview, type RosterRow } from './use-admin'

// AdminPage — the OWNER-ONLY control room (a full page on the Done/Reminders template, ADR-0027).
// Read-only in this first cut: AI spend (global + per-user), a guardrail-config reference, system
// stats + integration status, and invite management (folded in). Editable caps land in a follow-up.
//
// Two guards: this component early-returns a fallback when !useIsOwner() (below), and App only mounts
// it when isOwner. Both are UI-only — every privileged datum comes from the `admin` Edge Function,
// which re-checks OWNER_USER_ID server-side, so a forced client state still gets a 403.
//
// __GIT_COMMIT_SHA__ / __VERCEL_ENV__ are build-time defines (declared globally in vite-env.d.ts,
// injected by vite.config) — empty strings in local dev.

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="font-serif text-base font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  )
}

function SpendMeter({ spent, cap }: { spent: number; cap: number }) {
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0
  const danger = pct >= 80
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-muted">Global budget</span>
        <span className="font-medium text-ink">
          {formatUsd(spent)} <span className="text-muted">/ {formatUsd(cap)}</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-border">
        <div
          className={'h-full rounded-full ' + (danger ? 'bg-danger' : 'bg-primary')}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Global AI budget used"
        />
      </div>
      <p className="mt-1 text-xs text-muted">{pct}% of this month's pool used</p>
    </div>
  )
}

function Roster({ rows }: { rows: RosterRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">No AI spend yet this month.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted">
            <th className="py-1 pr-3 font-medium">User</th>
            <th className="py-1 pr-3 text-right font-medium">Spent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id} className="border-t border-border">
              <td className="py-1.5 pr-3">
                <span className="text-ink">{r.email ?? r.user_id.slice(0, 8)}</span>
              </td>
              <td className="py-1.5 pr-3 text-right font-medium text-ink">
                {formatUsd(r.spent_micros)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const INTEGRATION_LABELS: Record<string, string> = {
  anthropicKey: 'Anthropic API key',
  ownerUserId: 'Owner user id',
  allowedOrigin: 'CORS allowed origin',
  dispatchSecret: 'Dispatch secret',
  vapidPublicKey: 'VAPID public key',
  vapidPrivateKey: 'VAPID private key',
  vapidSubject: 'VAPID subject',
  spendAlertWebhook: 'Spend-alert webhook',
}

const DASHBOARDS: { label: string; url: string }[] = [
  { label: 'Supabase', url: 'https://supabase.com/dashboard' },
  { label: 'Vercel', url: 'https://vercel.com/dashboard' },
  { label: 'Anthropic', url: 'https://console.anthropic.com' },
  { label: 'Sentry', url: 'https://sentry.io' },
  { label: 'GitHub', url: 'https://github.com/braedensc/todoclaw' },
]

function Integrations({ integrations }: { integrations: Record<string, boolean> }) {
  const entries = Object.entries(integrations)
  return (
    <ul className="flex flex-col gap-1">
      {entries.map(([key, on]) => (
        <li key={key} className="flex items-center justify-between text-sm">
          <span className="text-muted">{INTEGRATION_LABELS[key] ?? key}</span>
          <span className={on ? 'text-primary' : 'text-muted-light'}>
            {on ? '● configured' : '○ not set'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Overview({ data }: { data: AdminOverview }) {
  const { config, globalSpend, roster, systemStats, integrations } = data
  const commit = typeof __GIT_COMMIT_SHA__ === 'string' && __GIT_COMMIT_SHA__
  const env = (typeof __VERCEL_ENV__ === 'string' && __VERCEL_ENV__) || 'local'

  return (
    <div className="flex flex-col gap-5">
      <Section title="AI spend this month" hint="Live from the budget ledgers.">
        {globalSpend ? (
          <SpendMeter spent={globalSpend.spentMicros} cap={globalSpend.capMicros} />
        ) : (
          <p className="text-sm text-muted">Budget status unavailable.</p>
        )}
        <div className="mt-4">
          <h4 className="mb-1 text-sm font-medium text-ink">By user</h4>
          <Roster rows={roster} />
        </div>
      </Section>

      {config && (
        <Section
          title="Guardrails"
          hint="The AI cost caps and rate limits currently in effect. Editing lands in a follow-up."
        >
          <Row label="Global monthly budget" value={formatUsd(config.globalBudgetCapMicros)} />
          <Row label="Per-user monthly cap" value={formatUsd(config.userBudgetCapMicros)} />
          <Row
            label="Chat rate limit"
            value={`${config.chatHourLimit}/hr · ${config.chatDayLimit}/day`}
          />
          <Row
            label="Plan My Day rate limit"
            value={`${config.planHourLimit}/hr · ${config.planDayLimit}/day`}
          />
          <Row label="Model" value="claude-sonnet-5" />
        </Section>
      )}

      <Section title="System">
        {systemStats && (
          <>
            <Row label="Users" value={systemStats.userCount} />
            <Row
              label="Invites"
              value={`${systemStats.inviteActive} active · ${systemStats.inviteTotal} total`}
            />
            <Row label="Redemptions" value={systemStats.redemptionCount} />
            <Row label="Push subscriptions" value={systemStats.pushSubCount} />
            <Row
              label="Last proactive message"
              value={
                systemStats.lastMessageAt
                  ? new Date(systemStats.lastMessageAt).toLocaleString()
                  : 'never'
              }
            />
          </>
        )}
        <Row label="Build" value={`${env}${commit ? ` · ${commit.slice(0, 7)}` : ''}`} />
        <div className="mt-3">
          <h4 className="mb-1 text-sm font-medium text-ink">Integrations</h4>
          <Integrations integrations={integrations} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {DASHBOARDS.map((d) => (
            <a
              key={d.label}
              href={d.url}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-muted hover:text-ink"
            >
              {d.label} ↗
            </a>
          ))}
        </div>
      </Section>

      <Section
        title="Invites"
        hint="Mint a link to onboard someone. Every invite spends your AI budget."
      >
        <InviteManager />
      </Section>
    </div>
  )
}

export function AdminPage() {
  const isOwner = useIsOwner()
  const overview = useAdminOverview()

  return (
    <div className="mx-auto max-w-2xl">
      <section className="rounded-xl border border-border-strong bg-panel p-6 shadow-sm">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">Admin</h2>
          <button
            type="button"
            onClick={goBack}
            aria-label="Close admin"
            className="rounded text-lg text-muted transition-colors hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            ✕
          </button>
        </header>

        {!isOwner ? (
          <p className="py-6 text-sm text-muted">This page is only available to the app owner.</p>
        ) : overview.isLoading ? (
          <p className="py-6 text-sm text-muted">Loading…</p>
        ) : overview.isError ? (
          <p className="py-6 text-sm text-danger">
            Couldn’t load the admin overview.{' '}
            {overview.error instanceof Error ? overview.error.message : ''}
          </p>
        ) : overview.data ? (
          <Overview data={overview.data} />
        ) : null}
      </section>
    </div>
  )
}
