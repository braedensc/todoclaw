# auth

Email/password authentication via Supabase Auth (GoTrue).

- **`use-session.ts`** — `useSession()` hook: the current `Session | null` plus a
  `loading` flag (true until the initial `getSession()` resolves). Subscribes to
  `onAuthStateChange` and unsubscribes on unmount.
- **`AuthForm.tsx`** — sign-in-only email/password form. On submit it calls
  `signInWithPassword`. The user is never asked for a `user_id`; the authenticated
  session's `auth.uid()` is what RLS and the `tasks.user_id` default use server-side.
  **Invite-only (Stage 4, ADR-0014):** the form has no open sign-up path.
  Public sign-up is disabled in the Supabase Auth dashboard; accounts are created by
  owner invite. Everyone who can sign in is trusted, which is what lets AI run on the
  owner's key for all users (ADR-0015).
- **`AuthGate.tsx`** — the pre-auth surface: shows `AuthForm`, or `RedeemInviteForm` when
  the visitor arrives via a `/#/redeem?code=…` link or the "Have an invite code?" toggle.
- **`RedeemInviteForm.tsx`** — code-gated account creation (ADR-0030). Posts
  `{ code, email, password }` to the `redeem-invite` Edge Function (which validates+claims
  the code and creates the account via the admin API — `enable_signup` stays off), then
  signs in. The only client path that ends in a new account, and it needs a valid
  owner-generated code.
- **`use-is-owner.ts`** — `useIsOwner()`: reveals the owner-only admin entry + "Invite someone" UI.
  Display-only, and derived from the **server** — it asks the `admin` Edge Function's `whoami`
  action whether the caller is the owner, so the owner's user id is never shipped to the client
  (no `VITE_OWNER_USER_ID`). Fails closed. The real gate is server-side (`OWNER_USER_ID`).

## Notes

- **Auth hardening** (require email confirmation, leaked-password protection, password
  policy, short JWT expiry, restricted redirect URLs) is configured in the **cloud**
  Supabase dashboard (Stage 1 PR #3). Disabling public sign-up + inviting users is also
  a dashboard step (Stage 4 — see docs/SERVICES.md).
- **Local test users:** with the client sign-in-only, create a local account via Supabase
  Studio (`supabase start` → Studio → Authentication → Add user) or the CLI, then sign in.
  Local email confirmation is **off**, so an added user can sign in immediately.
- The session is the single source of identity. The tasks feature relies on it via the
  Supabase client; it never passes a user id around.
