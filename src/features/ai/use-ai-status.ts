import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Mirrors the AiStatus shape returned by the ai-status Edge Function
// (supabase/functions/_shared/guardrails.ts getStatus).
export type AiFeature = 'chat' | 'plan_my_day'
export interface AiStatus {
  paused: boolean // the global monthly budget kill-switch has tripped
  budgetRemainingMicros: number
  limits: Record<AiFeature, { hour: number; day: number }>
  used: Record<AiFeature, { hour: number; day: number }>
}

// supabase.functions.invoke attaches the signed-in user's Authorization header automatically,
// so the Edge Function authenticates the caller and reads their own usage under RLS.
async function fetchAiStatus(): Promise<AiStatus> {
  const { data, error } = await supabase.functions.invoke<AiStatus>('ai-status')
  if (error) throw error
  if (!data) throw new Error('ai-status returned no data')
  return data
}

// Whether AI is currently available + how much budget/rate headroom remains. The AI panels
// (Plan My Day, chat) read `paused` to show an "AI paused this month" notice. staleTime keeps
// it from refetching every time a panel opens.
export function useAiStatus() {
  return useQuery({ queryKey: ['ai_status'], queryFn: fetchAiStatus, staleTime: 60_000 })
}
