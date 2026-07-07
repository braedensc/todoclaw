import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Owner-side invite-code data (ADR-0029). Listing/revoking read the owner's own `invites` rows
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

export function useGenerateInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (opts: GenerateOptions = {}): Promise<GeneratedInvite> => {
      const { data, error } = await supabase.functions.invoke<GeneratedInvite>('generate-invite', {
        body: opts,
      })
      if (error) throw error
      if (!data) throw new Error('generate-invite returned no data')
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
