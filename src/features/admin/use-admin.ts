import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Owner Admin panel data. Every field here comes from the owner-only `admin` Edge Function, which
// re-checks OWNER_USER_ID server-side (the real gate) and reads the privileged global / per-user /
// system data through service_role DEFINER RPCs. A non-owner invoking it gets a 403. Invite
// management reuses the existing settings/use-invite hooks (RLS-scoped), not this endpoint.

export interface GuardrailConfigDto {
  globalBudgetCapMicros: number
  userBudgetCapMicros: number
  chatHourLimit: number
  chatDayLimit: number
  planHourLimit: number
  planDayLimit: number
  updatedAt: string | null
  updatedBy: string | null
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

// $X.XX from micro-dollars (millionths of a USD).
export function formatUsd(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(2)}`
}
