import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useSession } from './use-session'

// Whether the signed-in user is the app owner (ADR-0030). Used ONLY to reveal the owner's admin
// entry point + "Invite someone" UI — never as a security boundary. The answer comes from the
// server (`admin` Edge Function, `whoami` action), which compares the JWT-verified caller against
// the server-only OWNER_USER_ID: the owner's user id is NEVER shipped to the client, so an attacker
// can't even learn which account is the owner. Fails CLOSED — no session, or any error, resolves to
// false, so the entry stays hidden on anything ambiguous. The real gate on every privileged datum
// is still the server-side OWNER_USER_ID check inside the Edge Function, so a forced `true` here
// reveals an empty page whose data request 403s.
export function useIsOwner(): boolean {
  const { session } = useSession()
  const userId = session?.user?.id ?? null

  const { data } = useQuery({
    queryKey: ['is-owner', userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.functions.invoke<{ isOwner: boolean }>('admin', {
        body: { action: 'whoami' },
      })
      if (error) return false // fail closed — never reveal the entry on an ambiguous result
      return Boolean(data?.isOwner)
    },
  })

  return data ?? false
}
