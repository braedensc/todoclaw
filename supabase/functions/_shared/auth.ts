// Auth — builds a Supabase client scoped to the CALLER's JWT, so every DB call this function
// makes runs as the signed-in user: RLS still applies and auth.uid() is the real user. This is
// the handle the AI functions use for all TOOL DB writes (tasks/habits/memories) — a prompt-injected
// tool can at worst touch the caller's own rows.
//
// The ONE deliberate exception is adminClient() below (ADR 2026-07-13-persistent-chats): chat
// transcript persistence goes through service_role-fenced SECURITY DEFINER RPCs so the browser can
// never forge an assistant turn. It is used ONLY for those RPCs — never for a tool write.
//
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are auto-injected into every Edge
// Function by the platform (no secret to set). The Authorization header is forwarded from the request.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

export function userClient(req: Request): SupabaseClient {
  const authorization = req.headers.get('Authorization') ?? ''
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Service-role client (BYPASSRLS). Reserved for calling the chat-transcript DEFINER RPCs, which are
// fenced to service_role and stamp role/user_id server-side — the browser has no write path to the
// chat tables, so an assistant turn cannot be forged. NEVER use this for a model-driven tool write;
// those stay on userClient (RLS). The RPCs additionally fence every session to the passed user id.
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

// Verifies the JWT against the auth server and returns the user id, or null if unauthenticated
// (no/expired/invalid token). Defense in depth on top of the platform's verify_jwt gate.
export async function requireUser(client: SupabaseClient): Promise<{ id: string } | null> {
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) return null
  return { id: data.user.id }
}
