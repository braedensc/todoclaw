import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { edgeErrorInfo } from '../../lib/edge-error'

// Owner-side invite-code data (ADR-0030). Listing/revoking read the owner's own `invites` rows
// (RLS-scoped); generating calls the owner-only generate-invite Edge Function. Redemption is
// server-side and not represented here.

export interface Invite {
  id: string
  code: string
  max_uses: number
  used_count: number
  expires_at: string | null
  revoked: boolean
  created_at: string
}

export interface GeneratedInvite {
  code: string
  url: string
  maxUses: number
  expiresAt: string
}

export interface GenerateOptions {
  maxUses?: number
  expiresInDays?: number
}

const INVITES_KEY = ['invites'] as const

async function fetchInvites(): Promise<Invite[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('id, code, max_uses, used_count, expires_at, revoked, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Invite[]
}

export function useInvites() {
  return useQuery({ queryKey: INVITES_KEY, queryFn: fetchInvites })
}

// The bounds generate-invite's Zod schema enforces (and the invites CHECK constraints back). Kept
// here so the form and the request clamp to the SAME numbers — an out-of-range value is a 400
// `invalid_request` the user can do nothing useful with.
export const MAX_USES_RANGE = { min: 1, max: 50 } as const
export const EXPIRES_DAYS_RANGE = { min: 1, max: 90 } as const

function clampInt(
  value: number | undefined,
  { min, max }: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

// generate-invite's `{ error: slug }` contract → copy that says what to actually do about it. The
// panel used to print the FunctionsHttpError message ("Edge Function returned a non-2xx status
// code"), which named neither the cause nor the fix.
const GENERATE_ERRORS: Record<string, string> = {
  unauthorized: 'Your session expired. Sign out and back in, then try again.',
  forbidden: 'Only the app owner can mint invites.',
  too_many_requests: 'Too many attempts — wait a minute and try again.',
  invalid_request: `Uses must be ${MAX_USES_RANGE.min}–${MAX_USES_RANGE.max} and expiry ${EXPIRES_DAYS_RANGE.min}–${EXPIRES_DAYS_RANGE.max} days.`,
  insert_failed: 'The server couldn’t save the invite. Try again in a moment.',
}

export async function generateInviteError(err: unknown): Promise<Error> {
  const { slug, status } = await edgeErrorInfo(err)
  const mapped = GENERATE_ERRORS[slug]
  if (mapped) return new Error(mapped)
  // Unmapped (or unreadable) — say so plainly and carry the status, so a bug report has a fact in it.
  return new Error(
    status
      ? `The invite service returned an unexpected error (HTTP ${status}).`
      : 'Couldn’t reach the invite service. Check your connection and try again.',
  )
}

export function useGenerateInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (opts: GenerateOptions = {}): Promise<GeneratedInvite> => {
      // Clamp before sending: a half-typed or cleared number field must never turn into a 400.
      const body = {
        maxUses: clampInt(opts.maxUses, MAX_USES_RANGE, MAX_USES_RANGE.min),
        expiresInDays: clampInt(opts.expiresInDays, EXPIRES_DAYS_RANGE, 7),
      }
      const { data, error } = await supabase.functions.invoke<GeneratedInvite>('generate-invite', {
        body,
      })
      if (error) throw await generateInviteError(error)
      if (!data) throw new Error('The invite service returned an empty response. Try again.')
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  })
}

export function useRevokeInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // RLS scopes this UPDATE to the owner's own row.
      const { error } = await supabase.from('invites').update({ revoked: true }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: INVITES_KEY }),
  })
}

// The shareable link for a code, built from the current origin (matches redeemUrl server-side).
export function inviteLink(code: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/#/redeem?code=${encodeURIComponent(code)}`
}

export type InviteStatus = 'active' | 'used_up' | 'expired' | 'revoked'

export function inviteStatus(invite: Invite): InviteStatus {
  if (invite.revoked) return 'revoked'
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) return 'expired'
  if (invite.used_count >= invite.max_uses) return 'used_up'
  return 'active'
}
