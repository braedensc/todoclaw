import { useSession } from './use-session'

// Whether the signed-in user is the app owner (ADR-0029). Used ONLY to reveal the owner's "Invite
// someone" UI — never as a security boundary. The real gate is the server-side OWNER_USER_ID check
// in the generate-invite Edge Function, so a user who forces this true still gets a 403. Returns
// false when VITE_OWNER_USER_ID is unset (dev / not configured).
export function useIsOwner(): boolean {
  const { session } = useSession()
  const ownerId = import.meta.env.VITE_OWNER_USER_ID
  return Boolean(ownerId && session?.user?.id === ownerId)
}
