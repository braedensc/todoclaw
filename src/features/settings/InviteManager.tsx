import { useId, useState } from 'react'
import {
  useGenerateInvite,
  useInvites,
  useRevokeInvite,
  inviteLink,
  inviteStatus,
  EXPIRES_DAYS_RANGE,
  MAX_USES_RANGE,
  type Invite,
  type InviteStatus,
} from './use-invite'

// InviteManager — the OWNER-ONLY invite UI (ADR-0030), as a presentational panel with NO dialog
// chrome, so it can be dropped into the Admin page as a section (it used to be the body of the
// standalone InvitePanel modal). Mint a redeemable link + list/revoke existing invites. Reachable
// only when useIsOwner() is true; the real gate is the server-side OWNER_USER_ID check in
// generate-invite (a non-owner who forces it open still gets a 403). Every invite is a bearer token
// that spends the owner's AI budget, so codes are single-use by default, always expire, and can be
// revoked here.

const STATUS_LABEL: Record<InviteStatus, string> = {
  active: 'Active',
  used_up: 'Used',
  expired: 'Expired',
  revoked: 'Revoked',
}

const STATUS_CLASS: Record<InviteStatus, string> = {
  active: 'bg-primary/10 text-primary',
  used_up: 'text-muted',
  expired: 'text-muted',
  revoked: 'text-danger',
}

// Shared small number input (also reused by the Admin caps form).
//
// The box keeps its own TEXT while you type, and only reports a number the parent can actually use.
// It used to be `value={value} onChange={Number(e.target.value)}`, which had two teeth: clearing the
// field reported `Number('') === 0` (below every min — the server 400s on it), and a partially-typed
// value like '5e' reported NaN (JSON-serialized to null — another 400). Both surfaced as an opaque
// "Edge Function returned a non-2xx status code". Now an empty or out-of-range box simply doesn't
// commit — the parent holds the last GOOD value — and blur normalizes the text back to it. That also
// fixes a display artifact of the old binding: React skips writing a number input whose DOM text
// loose-equals the new value, so clearing '7' and typing '5' left the box reading '05' forever.
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
}) {
  const id = useId()
  // `draft` is the in-flight edit and nothing else: null means "not being edited", so the box simply
  // shows the committed value and follows it if it ever changes from outside. No effect to sync.
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? String(value)

  return (
    <label htmlFor={id} className="flex flex-1 flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          const n = Number(raw)
          // Commit only a genuinely usable number; mid-edit junk leaves the last good value standing.
          if (raw.trim() && Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n))
        }}
        onBlur={() => {
          const n = Number(text)
          const usable = Boolean(text.trim()) && Number.isFinite(n)
          setDraft(null) // done editing — the box goes back to mirroring the committed value
          onChange(usable ? Math.min(max, Math.max(min, Math.round(n))) : value)
        }}
        className="rounded-lg border border-border-strong bg-card px-3 py-2 text-sm"
      />
    </label>
  )
}

export function InviteRow({ invite }: { invite: Invite }) {
  const revoke = useRevokeInvite()
  const status = inviteStatus(invite)
  return (
    <li className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm">
      <div className="min-w-0">
        <code className="font-mono text-xs text-ink">{invite.code}</code>
        <span className="ml-2 text-xs text-muted">
          {invite.used_count}/{invite.max_uses} used
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + STATUS_CLASS[status]}>
          {STATUS_LABEL[status]}
        </span>
        {status === 'active' && (
          <button
            type="button"
            onClick={() => revoke.mutate(invite.id)}
            disabled={revoke.isPending}
            className="text-xs text-muted hover:text-danger disabled:opacity-50"
          >
            Revoke
          </button>
        )}
      </div>
    </li>
  )
}

export function InviteManager() {
  const invitesQuery = useInvites()
  const generate = useGenerateInvite()

  const [maxUses, setMaxUses] = useState(1)
  const [expiresInDays, setExpiresInDays] = useState(7)
  const [copied, setCopied] = useState(false)

  const link = generate.data ? inviteLink(generate.data.code) : ''

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — the link is on screen to copy manually */
    }
  }

  async function share() {
    if (!link) return
    if ('share' in navigator && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'TodoClaw invite', text: 'Join me on TodoClaw', url: link })
      } catch {
        /* user dismissed the share sheet */
      }
    } else {
      await copy()
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Generate a link and text it to whoever you want to add. They open it, pick a password, and
        they’re in. Every invite spends your AI budget, so links are single-use and expire by
        default — revoke any you didn’t mean to send.
      </p>

      <div className="flex items-end gap-3">
        <NumberField
          label="Uses"
          value={maxUses}
          onChange={setMaxUses}
          min={MAX_USES_RANGE.min}
          max={MAX_USES_RANGE.max}
        />
        <NumberField
          label="Expires (days)"
          value={expiresInDays}
          onChange={setExpiresInDays}
          min={EXPIRES_DAYS_RANGE.min}
          max={EXPIRES_DAYS_RANGE.max}
        />
        <button
          type="button"
          onClick={() => generate.mutate({ maxUses, expiresInDays })}
          disabled={generate.isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {generate.isPending ? '…' : 'Generate link'}
        </button>
      </div>

      {generate.isError && (
        <p className="mt-3 text-sm text-danger" role="alert">
          Couldn’t create an invite.{' '}
          {generate.error instanceof Error ? generate.error.message : 'Please try again.'}
        </p>
      )}

      {generate.data && (
        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="mb-1 text-xs font-medium text-muted">Share this link</p>
          <p className="break-all font-mono text-xs text-ink">{link}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={share}
              className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            >
              Share
            </button>
            <button
              type="button"
              onClick={copy}
              className="rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium text-ink hover:bg-bg"
            >
              {copied ? 'Copied ✓' : 'Copy link'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6">
        <h4 className="mb-1 text-sm font-medium text-ink">Your invites</h4>
        {invitesQuery.isLoading ? (
          <p className="py-3 text-sm text-muted">Loading…</p>
        ) : invitesQuery.data && invitesQuery.data.length > 0 ? (
          <ul className="flex flex-col">
            {invitesQuery.data.map((invite) => (
              <InviteRow key={invite.id} invite={invite} />
            ))}
          </ul>
        ) : (
          <p className="py-3 text-sm text-muted">No invites yet.</p>
        )}
      </div>
    </div>
  )
}
