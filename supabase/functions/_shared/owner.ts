// owner.ts — the single owner-identity gate shared by the owner-only Edge Functions
// (generate-invite, admin). "Owner" is an env-var UUID (OWNER_USER_ID) compared against the
// JWT-verified caller id. This is the REAL server-side gate; the frontend useIsOwner() only hides
// UI. If OWNER_USER_ID is unset, NO ONE is the owner (a safe default — refuse). Pure, so it is
// unit-testable without an HTTP harness.

export function isOwner(
  userId: string | null | undefined,
  ownerEnv: string | null | undefined,
): boolean {
  return Boolean(ownerEnv && userId && userId === ownerEnv)
}
