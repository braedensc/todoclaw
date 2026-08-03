// ip-throttle.ts — a coarse per-IP throttle for the client-facing verify_jwt=false functions.
//
// Those functions run with the platform gateway's JWT check OFF (so the CORS preflight isn't 401'd),
// which means an unauthenticated request reaches function code before auth. This is defense-in-depth
// on top of the platform's edge DDoS protection: check a per-IP budget BEFORE auth so a flood from one
// IP is turned away cheaply. Keyed on a spoof-resistant IP (client-ip.ts) and a per-function `bucket`;
// the counting/recording is the edge_ip_throttle DEFINER RPC (20260722020000).
//
// FAILS OPEN: a throttle-bookkeeping hiccup — or the RPC not being deployed yet — returns "allowed"
// rather than breaking a legitimate request. Availability of the real feature outranks this guard.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { clientIp } from './client-ip.ts'

// A throttle call must not depend on the caller's JWT (the point is to run before auth, on possibly
// unauthenticated requests), so it goes through a plain anon client. The RPC is granted to anon.
function anonClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * True if the request is within its per-IP budget for `bucket` (window `windowSeconds`), false if the
 * IP is over the limit. An unknown IP (e.g. local serve) is allowed. `client` is injectable for tests.
 */
export async function ipThrottleOk(
  req: Request,
  bucket: string,
  limit: number,
  windowSeconds: number,
  client: SupabaseClient = anonClient(),
): Promise<boolean> {
  const ip = clientIp(req)
  if (!ip) return true // unknown IP ⇒ don't throttle (the RPC would allow it anyway)

  const { data, error } = await client.rpc('edge_ip_throttle', {
    p_bucket: bucket,
    p_ip: ip,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) {
    console.error('edge_ip_throttle failed (allowing request):', bucket, error.message)
    return true // fail open
  }
  return data !== false
}
