# admin — owner-only control room

A single owner-only page (`/#/admin`, `AdminPage.tsx`) that consolidates the things only the app
owner should see: AI spend (global pool + per-user roster), the guardrail-config reference, system
stats + integration status, and invite management (folded in from `settings/InviteManager`).

## Security

- **UI reveal is cosmetic.** `useIsOwner()` (`auth/use-is-owner.ts`) only decides whether the entry
  point and page render; it asks the server (`admin` Edge Function, `whoami` action) whether the
  caller is the owner, so the owner's user id is never published to the client. Fails closed.
- **The real gate is server-side.** All privileged data comes from the `admin` Edge Function
  (`supabase/functions/admin`), which re-checks `OWNER_USER_ID` (shared `isOwner` helper) and reads
  global / per-user / `auth.users` data through `SECURITY DEFINER` RPCs granted to `service_role`
  only. A non-owner who forces the client state still gets a **403**.
- **No secret values** ever reach the client — integration status is booleans only.

## Data

`use-admin.ts` → `useAdminOverview()` invokes `admin` with `{ action: 'get_overview' }`
(30s `staleTime`). Invite create/revoke reuse `settings/use-invite` (RLS-scoped), not this endpoint.

## Editing caps (follow-up)

Read-only today. Making the caps/limits editable adds a `set_config` action + `app_config_set`
DEFINER RPC (four clamp layers) and an ADR — see the plan. The guardrail loader
(`_shared/guardrails-config.ts`) already reads the live values from `app_config`, so an edit takes
effect without a deploy.
