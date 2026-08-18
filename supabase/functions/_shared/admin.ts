// Admin — the ONE service-role Supabase client in the codebase, and deliberately the only place
// SUPABASE_SERVICE_ROLE_KEY is used (ADR-0030). Every other function talks to the DB through the
// CALLER's JWT (auth.ts) so RLS isolates data; this client BYPASSES RLS and has admin auth
// powers, so it is fenced to the invite pair — redeem-invite (auth.admin.createUser, which has no
// non-admin path) and generate-invite (the mint). NOTE: service_role bypasses RLS but holds NO
// table DML in this project, so "admin" writes still go through SECURITY DEFINER RPCs — the invite
// mint/claim/throttle/release are granted to service_role only, and this client is how the two
// functions reach them; the whole invite mechanism stays off the public PostgREST surface.
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
