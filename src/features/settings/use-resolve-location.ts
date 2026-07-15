import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

// Resolves a typed location to the place wttr.in's geocoder actually matched, so Settings can show
// it back instead of leaving the user to guess. Mirrors the resolve-location Edge Function's
// contract — a failed lookup is a 200 with ok:false, so `error` here means a REAL failure
// (unauthenticated, network, the function itself down), never "no such place".
export type ResolveResult =
  | { ok: true; label: string }
  | { ok: false; reason: 'not_found' | 'unavailable' }

async function fetchResolve(location: string): Promise<ResolveResult> {
  const { data, error } = await supabase.functions.invoke<ResolveResult>('resolve-location', {
    body: { location },
  })
  // Anything that isn't a clean answer degrades to `unavailable` — the retryable, non-accusatory
  // state. We must never tell someone their real city doesn't exist because our own call failed.
  if (error || !data) return { ok: false, reason: 'unavailable' }
  return data
}

// Returns a `resolve(location)` callback. Goes through fetchQuery rather than a bare fetch for the
// DEDUPE: clicking Save blurs the field, so the blur's lookup and the save's lookup fire back to
// back on the same string — fetchQuery hands both callers the one in-flight promise.
export function useResolveLocation() {
  const qc = useQueryClient()
  return useCallback(
    async (location: string): Promise<ResolveResult> => {
      const q = location.trim()
      if (!q) return { ok: false, reason: 'unavailable' }
      const queryKey = ['resolve_location', q]
      const res = await qc.fetchQuery({
        queryKey,
        queryFn: () => fetchResolve(q),
        // A place's resolution doesn't change, so a hit is good indefinitely — re-opening Settings
        // and re-blurring an unchanged location costs nothing.
        staleTime: Infinity,
      })
      // ...but a transient failure must NOT be pinned by that Infinity, or one blip would wedge
      // "couldn't check right now" for the rest of the session. Drop it so the next blur retries.
      if (!res.ok && res.reason === 'unavailable') qc.removeQueries({ queryKey })
      return res
    },
    [qc],
  )
}
