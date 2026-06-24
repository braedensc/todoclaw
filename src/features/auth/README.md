# auth

Email/password authentication via Supabase Auth (GoTrue).

- **`use-session.ts`** — `useSession()` hook: the current `Session | null` plus a
  `loading` flag (true until the initial `getSession()` resolves). Subscribes to
  `onAuthStateChange` and unsubscribes on unmount.
- **`AuthForm.tsx`** — sign-in-only email/password form. On submit it calls
  `signInWithPassword`. The user is never asked for a `user_id`; the authenticated
  session's `auth.uid()` is what RLS and the `tasks.user_id` default use server-side.
  **Invite-only (Stage 4, ADR-0014):** there is no account-creation path in the client.
  Public sign-up is disabled in the Supabase Auth dashboard; accounts are created by
  owner invite. Everyone who can sign in is trusted, which is what lets AI run on the
  owner's key for all users (ADR-0015).

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
