// Admin — the ONE service-role Supabase client in the codebase, and deliberately the only place
// SUPABASE_SERVICE_ROLE_KEY is used (ADR-0029). Every other function talks to the DB through the
// CALLER's JWT (auth.ts) so RLS isolates data; this client BYPASSES RLS and has admin auth
// powers, so it is fenced to exactly one caller — redeem-invite — and used for exactly one thing
// that has no non-admin path: auth.admin.createUser (create the invited account). The invite
// claim/throttle/release run through SECURITY DEFINER RPCs that are granted to service_role only,
// so this client is also how the redeem function reaches them — the whole invite mechanism stays
// off the public PostgREST surface.
//
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-injected into every Edge Function by the
// platform — the service-role key is NEVER set as a project secret we manage, never in the client
// bundle, and never logged. Reference by name only.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !serviceRoleKey) throw new Error('admin_client_unconfigured')
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
