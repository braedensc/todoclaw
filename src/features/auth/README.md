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
- **`AuthGate.tsx`** — the pre-auth surface: shows `AuthForm`, `RedeemInviteForm` when
  the visitor arrives via a `/#/redeem?code=…` link or the "Have an invite code?" toggle, or
  `UpdatePasswordForm` when `App` passes a `recovery` prop. It also shows a notice when a reset
  link turns out to be expired or already used.
- **`UpdatePasswordForm.tsx`** — the screen a password-recovery link lands on. Calls
  `updateUser({ password })` on the session the link already established, and signs out if the
  user backs out (see the recovery note below). `MIN_PASSWORD_LENGTH` here, `RedeemInviteForm`'s
  `minLength`, and `minimum_password_length` in `supabase/config.toml` must agree.
- **`RedeemInviteForm.tsx`** — code-gated account creation (ADR-0030). Posts
  `{ code, email, password }` to the `redeem-invite` Edge Function (which validates+claims
  the code and creates the account via the admin API — `enable_signup` stays off), then
  signs in. The only client path that ends in a new account, and it needs a valid
  owner-generated code.
- **`use-is-owner.ts`** — `useIsOwner()`: reveals the owner-only admin entry + "Invite someone" UI.
  Display-only, and derived from the **server** — it asks the `admin` Edge Function's `whoami`
  action whether the caller is the owner, so the owner's user id is never shipped to the client
  (no `VITE_OWNER_USER_ID`). Fails closed. The real gate is server-side (`OWNER_USER_ID`).

## Password recovery (TOD-87)

"Forgot password?" on `AuthForm` calls `resetPasswordForEmail`. Everything subtle is on the
**return** trip, so read this before touching it:

- The client runs auth-js's defaults — `flowType: 'implicit'` and `detectSessionInUrl`. A
  recovery link therefore arrives as `#access_token=…&type=recovery`, and auth-js consumes that
  fragment, **establishes a real session**, and **clears `window.location.hash`** during its own
  async initialization. The ADR-0027 hash router never sees it; there is no route to add.
- auth-js signals recovery exactly once, as a `PASSWORD_RECOVERY` event emitted on a
  `setTimeout(…, 0)`. A `useEffect` subscription can lose that race — and `use-session.ts`
  discards the event name anyway. **Do not build on catching that event.** `lib/recovery-landing.ts`
  instead reads the hash synchronously at module load, before auth-js can clear it.
- Because the link arrives already signed in, `App` checks recovery **before** `session`. Getting
  that order wrong is the original bug: the shell renders, nothing prompts for a new password, and
  the reset link silently becomes a passwordless login that leaves the old password valid.
  `src/App.test.tsx` pins it.
- Backing out of `UpdatePasswordForm` signs the user out, so an abandoned flow cannot leave a
  usable session that skipped the change.

## Notes

- **Auth hardening** (require email confirmation, leaked-password protection, password
  policy, short JWT expiry, restricted redirect URLs) is configured in the **cloud**
  Supabase dashboard (Stage 1 PR #3). Disabling public sign-up + inviting users is also
  a dashboard step (Stage 4 — see docs/SERVICES.md). The three settings recovery depends on
  are tabulated in docs/SERVICES.md so drift is detectable.
- **Sign-in deliberately does not enforce the new-password minimum.** `AuthForm`'s password
  field keeps `minLength={6}` while new passwords require 8 — raising it would lock out any
  existing account whose password predates the policy. Only the *setting* surfaces enforce 8.
- **Local test users:** with the client sign-in-only, create a local account via Supabase
  Studio (`supabase start` → Studio → Authentication → Add user) or the CLI, then sign in.
  Local email confirmation is **off**, so an added user can sign in immediately.
- The session is the single source of identity. The tasks feature relies on it via the
  Supabase client; it never passes a user id around.
