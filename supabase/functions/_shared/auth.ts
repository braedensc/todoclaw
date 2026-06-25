// Auth — builds a Supabase client scoped to the CALLER's JWT, so every DB call this function
// makes runs as the signed-in user: RLS still applies and auth.uid() is the real user. This
// is the ONLY DB handle the AI functions use — there is no service-role/admin client here, so
// a prompt-injected tool can at worst touch the caller's own rows.
//
// SUPABASE_URL / SUPABASE_ANON_KEY are auto-injected into every Edge Function by the platform
// (no secret to set). The Authorization header is forwarded from the incoming request.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get('Authorization') ?? ''
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Verifies the JWT against the auth server and returns the user id, or null if unauthenticated
// (no/expired/invalid token). Defense in depth on top of the platform's verify_jwt gate.
export async function requireUser(client: SupabaseClient): Promise<{ id: string } | null> {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) return null
  return { id: data.user.id }
}
