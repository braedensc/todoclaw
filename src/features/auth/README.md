# auth

Email/password authentication via Supabase Auth (GoTrue).

- **`use-session.ts`** — `useSession()` hook: the current `Session | null` plus a
  `loading` flag (true until the initial `getSession()` resolves). Subscribes to
  `onAuthStateChange` and unsubscribes on unmount.
- **`AuthForm.tsx`** — minimal sign-in / sign-up form. On submit it calls
  `signInWithPassword` or `signUp`. The user is never asked for a `user_id`; the
  authenticated session's `auth.uid()` is what RLS and the `tasks.user_id` default
  use server-side.

## Notes

- **Stage 1 scope:** the bare minimum to prove the auth → DB → render path. Real auth
  hardening (require email confirmation, leaked-password protection, password policy,
  short JWT expiry, restricted redirect URLs) is configured in the **cloud** Supabase
  dashboard in PR #3. Local dev has email confirmation **off**, so sign-up logs you in
  immediately — convenient for testing.
- The session is the single source of identity. The tasks feature relies on it via the
  Supabase client; it never passes a user id around.
