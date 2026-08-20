import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Owner Admin panel data. Every field here comes from the owner-only `admin` Edge Function, which
// re-checks OWNER_USER_ID server-side (the real gate) and reads the privileged global / per-user /
// system data through service_role DEFINER RPCs. A non-owner invoking it gets a 403. Invite
// management reuses the existing settings/use-invite hooks (RLS-scoped), not this endpoint.

export interface GuardrailConfigDto {
  globalBudgetCapMicros: number
  userBudgetCapMicros: number
  aiBudgetBaseMicros: number
  chatHourLimit: number
  chatDayLimit: number
  planHourLimit: number
  planDayLimit: number
  chatModel: string
  planModel: string
  updatedAt: string | null
  updatedBy: string | null
}

// Per-feature model allowlists — MIRROR the server's ALLOWED_CHAT_MODELS / ALLOWED_PLAN_MODELS
// (supabase/functions/_shared/guardrails-constants.ts) and the app_config CHECKs; the server
// re-validates, so drift here only mislabels the dropdown, never widens what can be stored. Chat
// excludes Opus by design (a worst-case chat call on Opus would breach the fixed $0.20 per-call
// clamp); the plan path is small enough to allow it.
export const CHAT_MODEL_OPTIONS = ['claude-haiku-4-5', 'claude-sonnet-5'] as const
export const PLAN_MODEL_OPTIONS = ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'] as const

// Friendly labels for the dropdowns (ids stay the stored values).
export const MODEL_LABELS: Record<string, string> = {
  'claude-haiku-4-5': 'Haiku 4.5 — fastest, ~3× cheaper',
  'claude-sonnet-5': 'Sonnet 5 — default',
  'claude-opus-5': 'Opus 5 — deepest, ~1.7× dearer',
}

export interface GlobalSpend {
  period: string
  spentMicros: number
  capMicros: number
  remainingMicros: number
}

export interface RosterRow {
  user_id: string
  email: string | null
  spent_micros: number
  updated_at: string
}

export interface SystemStats {
  userCount: number
  inviteTotal: number
  inviteActive: number
  redemptionCount: number
  pushSubCount: number
  lastMessageAt: string | null
}

export interface AdminOverview {
  config: GuardrailConfigDto | null
  globalSpend: GlobalSpend | null
  roster: RosterRow[]
  systemStats: SystemStats | null
  integrations: Record<string, boolean>
}

export const ADMIN_OVERVIEW_KEY = ['admin_overview'] as const

export function useAdminOverview() {
  return useQuery({
    queryKey: ADMIN_OVERVIEW_KEY,
    queryFn: async (): Promise<AdminOverview> => {
      const { data, error } = await supabase.functions.invoke<AdminOverview>('admin', {
        body: { action: 'get_overview' },
      })
      if (error) throw error
      if (!data) throw new Error('admin overview returned no data')
      return data
    },
    staleTime: 30_000,
  })
}

// Partial guardrail-config patch — only the keys to change. This PR's UI exposes the model knobs;
// the numeric knobs are accepted by the same `set_config` action for follow-ups.
export interface GuardrailConfigPatch {
  globalBudgetCapMicros?: number
  userBudgetCapMicros?: number
  aiBudgetBaseMicros?: number
  chatHourLimit?: number
  chatDayLimit?: number
  planHourLimit?: number
  planDayLimit?: number
  chatModel?: string
  planModel?: string
}

// Write a partial config patch via the owner-only `set_config` action (Zod-clamped at the edge,
// clamped + audited again in the app_config_set DEFINER RPC). The server answers with a FRESH
// overview; on success we invalidate the overview query so every tab re-reads it (same
// invalidation grain as useUpdateTask — the hook owns its queryClient).
export function useSetAdminConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: GuardrailConfigPatch): Promise<AdminOverview> => {
      const { data, error } = await supabase.functions.invoke<AdminOverview>('admin', {
        body: { action: 'set_config', config: patch },
      })
      if (error) throw error
      if (!data) throw new Error('set_config returned no data')
      return data
    },
    onSuccess: (data) => {
      qc.setQueryData(ADMIN_OVERVIEW_KEY, data) // the response IS the fresh overview
      qc.invalidateQueries({ queryKey: ADMIN_OVERVIEW_KEY })
    },
  })
}

// $X.XX from micro-dollars (millionths of a USD).
export function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}
