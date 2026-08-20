import { useState, type ReactNode } from 'react'
import { goBack } from '../../lib/route'
import { useIsOwner } from '../auth/use-is-owner'
import { InviteManager } from '../settings/InviteManager'
import {
  useAdminOverview,
  useSetAdminConfig,
  formatUsd,
  CHAT_MODEL_OPTIONS,
  PLAN_MODEL_OPTIONS,
  MODEL_LABELS,
  type AdminOverview,
  type RosterRow,
} from './use-admin'
import { LIMIT_GROUPS, type LimitGroup, type LimitKind } from './limits-reference'

// AdminPage — the OWNER-ONLY control room (a full page on the Done/Reminders template, ADR-0027).
// Tabbed (Overview · Guardrails · Limits · Invites · System) so the growing pile of owner info stays
// scannable: AI spend (metered against the scaled EFFECTIVE cap), the live guardrail config (models
// + the scaled-budget base editable in Guardrails), a full limits reference, system stats +
// integration status, and invite management.
//
// Two guards: this component early-returns a fallback when !useIsOwner() (below), and App only mounts
// it when isOwner. Both are UI-only — every privileged datum comes from the `admin` Edge Function,
// which re-checks OWNER_USER_ID server-side, so a forced client state still gets a 403. The Limits
// tab is static, non-secret reference content (see limits-reference.ts) — nothing sensitive here.
//
// __GIT_COMMIT_SHA__ / __VERCEL_ENV__ are build-time defines (declared globally in vite-env.d.ts,
// injected by vite.config) — empty strings in local dev.

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
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

// spent vs the EFFECTIVE cap (the scaled value precheck enforces), not the raw manual ceiling —
// the meter must show how close AI is to actually pausing.
function SpendMeter({
  spent,
  cap,
  label = 'Global budget',
}: {
  spent: number
  cap: number
  label?: string
}) {
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0
  const danger = pct >= 80
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="text-muted">{label}</span>
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

// --- Limits tab (static, read-only reference) -----------------------------------------------------

function KindBadge({ kind }: { kind?: LimitKind }) {
  if (!kind) return null
  const tunable = kind === 'tunable'
  return (
    <span
      className={
        'ml-2 shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium ' +
        (tunable ? 'border-primary/40 text-primary' : 'border-border text-muted-light')
      }
    >
      {tunable ? 'tunable' : 'fixed'}
    </span>
  )
}

function LimitGroupBlock({ group }: { group: LimitGroup }) {
  return (
    <details className="group border-t border-border py-1.5" open={group.defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1 [&::-webkit-details-marker]:hidden">
        <span className="text-xs text-muted-light transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="text-sm font-medium text-ink">{group.title}</span>
        <span className="ml-auto text-[11px] text-muted-light">{group.rows.length}</span>
      </summary>
      {group.hint && <p className="mb-1 ml-5 mt-0.5 text-xs text-muted">{group.hint}</p>}
      <div className="ml-5">
        {group.rows.map((r) => (
          <div key={r.name} className="flex items-baseline justify-between gap-3 py-1 text-sm">
            <span className="text-muted">
              {r.name}
              {r.scope && <span className="ml-1.5 text-[11px] text-muted-light">· {r.scope}</span>}
            </span>
            <span className="flex shrink-0 items-baseline text-right">
              <span className="font-medium text-ink">{r.value}</span>
              <KindBadge kind={r.kind} />
            </span>
          </div>
        ))}
      </div>
    </details>
  )
}

function LimitsTab() {
  return (
    <div>
      <p className="text-xs text-muted">
        Read-only reference. The <span className="text-ink">tunable</span> values show live in the
        Guardrails tab; everything else is a fixed constant. Full detail with source cites lives in{' '}
        <code className="rounded bg-border/60 px-1 py-px text-[11px]">docs/LIMITS.md</code>.
      </p>
      <div className="mt-2">
        {LIMIT_GROUPS.map((g) => (
          <LimitGroupBlock key={g.id} group={g} />
        ))}
      </div>
    </div>
  )
}

// --- Tabs -----------------------------------------------------------------------------------------

type AdminTab = 'overview' | 'guardrails' | 'limits' | 'invites' | 'system'
const TABS: ReadonlyArray<{ id: AdminTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'limits', label: 'Limits' },
  { id: 'invites', label: 'Invites' },
  { id: 'system', label: 'System' },
]

function TabBar({ tab, onTab }: { tab: AdminTab; onTab: (t: AdminTab) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Admin sections"
      className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-border px-1"
    >
      {TABS.map((t) => {
        const on = t.id === tab
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onTab(t.id)}
            className={
              '-mb-px whitespace-nowrap rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ' +
              (on ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink')
            }
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

// Data-backed tabs (Overview/Guardrails/System) share the one overview fetch; Limits/Invites are
// self-sufficient so they render even if that fetch fails.
function DataTab({
  overview,
  children,
}: {
  overview: ReturnType<typeof useAdminOverview>
  children: (data: AdminOverview) => ReactNode
}) {
  if (overview.isLoading) return <p className="py-6 text-sm text-muted">Loading…</p>
  if (overview.isError)
    return (
      <p className="py-6 text-sm text-danger">
        Couldn’t load the admin overview.{' '}
        {overview.error instanceof Error ? overview.error.message : ''}
      </p>
    )
  if (!overview.data) return null
  return <>{children(overview.data)}</>
}

function OverviewTab({ data }: { data: AdminOverview }) {
  const { globalSpend, roster } = data
  // Fall back to the raw ceiling only when a stale edge fn omits the scaled fields (deploy skew).
  const scaled = typeof data.effectiveCapMicros === 'number'
  return (
    <Section title="AI spend this month" hint="Live from the budget ledgers.">
      {globalSpend ? (
        <>
          <SpendMeter
            spent={globalSpend.spentMicros}
            cap={data.effectiveCapMicros ?? globalSpend.capMicros}
            label={scaled ? 'Global budget (effective cap)' : 'Global budget'}
          />
          {scaled && (
            <p className="mt-1 text-xs text-muted">
              Cap scales with adoption — {data.activeUserCount ?? 0} active AI{' '}
              {data.activeUserCount === 1 ? 'user' : 'users'} this month. Breakdown in Guardrails.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">Budget status unavailable.</p>
      )}
      <div className="mt-4">
        <h4 className="mb-1 text-sm font-medium text-ink">By user</h4>
        <Roster rows={roster} />
      </div>
    </Section>
  )
}

// One labelled model dropdown (Guardrails tab). Options come from the per-feature allowlists.
function ModelSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: readonly string[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-sm">
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border-strong bg-panel px-2 py-1 text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {MODEL_LABELS[m] ?? m}
          </option>
        ))}
      </select>
    </div>
  )
}

// Client-side mirror of HARD_MAX.base ($100) — the server re-clamps (Zod + app_config_set + table
// CHECK), so drift here only mislabels the input bound, never widens what can be stored.
const BASE_MAX_USD = 100

function GuardrailsTab({ data }: { data: AdminOverview }) {
  const { config } = data
  const setConfig = useSetAdminConfig()
  // Local edits, seeded from the live config; Save sends only the keys that changed.
  const [chatModel, setChatModel] = useState<string | null>(null)
  const [planModel, setPlanModel] = useState<string | null>(null)
  const [baseInput, setBaseInput] = useState<string | null>(null) // dollars, as typed
  if (!config) return <p className="py-6 text-sm text-muted">Guardrail config unavailable.</p>

  const chatValue = chatModel ?? config.chatModel
  const planValue = planModel ?? config.planModel
  const baseValue = baseInput ?? String(config.aiBudgetBaseMicros / 1_000_000)
  const baseMicros = Math.round(Number(baseValue) * 1_000_000)
  const baseValid =
    baseValue.trim() !== '' &&
    Number.isFinite(baseMicros) &&
    baseMicros >= 0 &&
    baseMicros <= BASE_MAX_USD * 1_000_000
  const baseDirty = baseValid && baseMicros !== config.aiBudgetBaseMicros
  const dirty = chatValue !== config.chatModel || planValue !== config.planModel || baseDirty

  const save = () => {
    const patch: { chatModel?: string; planModel?: string; aiBudgetBaseMicros?: number } = {}
    if (chatValue !== config.chatModel) patch.chatModel = chatValue
    if (planValue !== config.planModel) patch.planModel = planValue
    if (baseDirty) patch.aiBudgetBaseMicros = baseMicros
    setConfig.mutate(patch, {
      onSuccess: () => {
        setChatModel(null)
        setPlanModel(null)
        setBaseInput(null)
      },
    })
  }

  return (
    <Section
      title="Guardrails"
      hint="The AI cost caps and rate limits currently in effect. Effective cap = min(base + per-user cap × active users, manual ceiling, $100 hard max)."
    >
      <Row
        label="Effective global cap"
        value={formatUsd(data.effectiveCapMicros ?? config.globalBudgetCapMicros)}
      />
      <Row label="Active AI users (this month)" value={data.activeUserCount ?? '—'} />
      <Row label="Manual ceiling" value={formatUsd(config.globalBudgetCapMicros)} />
      <Row label="Per-user monthly cap" value={formatUsd(config.userBudgetCapMicros)} />
      <Row
        label="Chat rate limit"
        value={`${config.chatHourLimit}/hr · ${config.chatDayLimit}/day`}
      />
      <Row
        label="Plan My Day rate limit"
        value={`${config.planHourLimit}/hr · ${config.planDayLimit}/day`}
      />
      <div className="mt-3 border-t border-border pt-2">
        <h4 className="mb-1 text-sm font-medium text-ink">Models &amp; budget base</h4>
        <div className="flex items-center justify-between gap-3 py-1 text-sm">
          <label htmlFor="admin-budget-base" className="text-muted">
            Scaled-budget base ($/mo)
          </label>
          <input
            id="admin-budget-base"
            type="number"
            min={0}
            max={BASE_MAX_USD}
            step={1}
            value={baseValue}
            onChange={(e) => setBaseInput(e.target.value)}
            className="w-24 rounded-lg border border-border-strong bg-panel px-2 py-1 text-right text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
        {!baseValid && (
          <p className="text-xs text-danger">Base must be a dollar amount from 0 to 100.</p>
        )}
        <ModelSelect
          id="admin-chat-model"
          label="Chat model"
          value={chatValue}
          options={CHAT_MODEL_OPTIONS}
          onChange={setChatModel}
        />
        <ModelSelect
          id="admin-plan-model"
          label="Plan model"
          value={planValue}
          options={PLAN_MODEL_OPTIONS}
          onChange={setPlanModel}
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || !baseValid || setConfig.isPending}
            className="rounded-full border border-primary/60 px-3.5 py-1 text-sm font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-default disabled:border-border disabled:text-muted-light"
          >
            {setConfig.isPending ? 'Saving…' : 'Save changes'}
          </button>
          {setConfig.isError && (
            <span className="text-xs text-danger">Couldn’t save — try again.</span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted">
          Takes effect within ~30s (server config + active-count caches) — no deploy. Chat never
          runs Opus: a worst-case chat call would breach the fixed $0.20 per-call ceiling.
        </p>
      </div>
    </Section>
  )
}

function SystemTab({ data }: { data: AdminOverview }) {
  const { systemStats, integrations } = data
  const commit = typeof __GIT_COMMIT_SHA__ === 'string' && __GIT_COMMIT_SHA__
  const env = (typeof __VERCEL_ENV__ === 'string' && __VERCEL_ENV__) || 'local'
  return (
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
  )
}

export function AdminPage() {
  const isOwner = useIsOwner()
  const overview = useAdminOverview()
  const [tab, setTab] = useState<AdminTab>('overview')

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
        ) : (
          <>
            <TabBar tab={tab} onTab={setTab} />
            {tab === 'overview' && (
              <DataTab overview={overview}>{(d) => <OverviewTab data={d} />}</DataTab>
            )}
            {tab === 'guardrails' && (
              <DataTab overview={overview}>{(d) => <GuardrailsTab data={d} />}</DataTab>
            )}
            {tab === 'limits' && <LimitsTab />}
            {tab === 'invites' && (
              <Section
                title="Invites"
                hint="Mint a link to onboard someone. Every invite spends your AI budget."
              >
                <InviteManager />
              </Section>
            )}
            {tab === 'system' && (
              <DataTab overview={overview}>{(d) => <SystemTab data={d} />}</DataTab>
            )}
          </>
        )}
      </section>
    </div>
  )
}
