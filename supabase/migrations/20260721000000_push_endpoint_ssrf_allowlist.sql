-- Migration: constrain push_subscriptions.endpoint to real Web Push services (blind-SSRF guard).
--
-- Intent: push_subscriptions.endpoint is untrusted input — the browser's PushManager hands it to the
-- client, which upserts it (owner RLS). The dispatch crons (dispatch-messages / dispatch-reminders)
-- then VAPID-sign a request and POST to that URL from inside our infra. An unvalidated endpoint is a
-- blind-SSRF gadget: a crafted row could aim those signed POSTs at 169.254.169.254 (cloud metadata),
-- localhost, or an internal service. This CHECK closes the write side: only the four legitimate push
-- services can be stored. The runtime send guard (isAllowedPushEndpoint in _shared/web-push.ts) is the
-- mirror on the read side and must stay in sync with the hosts below.
--
--   • FCM (Chrome/Android):   fcm.googleapis.com                     — exact host
--   • Apple (Safari/iOS):     <dc>.push.apple.com                    — per-datacenter subdomain
--   • WNS (Edge/Windows):     <dc>.notify.windows.com                — per-datacenter subdomain
--   • Mozilla (Firefox):      updates.push.services.mozilla.com      — exact host
--
-- The regexes anchor `^https://<host>` and require the char after the host to be `/`, `:`, `?`, or
-- end-of-string, which defeats host-spoofing suffixes/userinfo: `...apple.com.evil.com` and
-- `...apple.com@evil.com` both fail (next char is `.`/`@`, not a boundary). Case-insensitive (`~*`)
-- because hosts are case-insensitive.
--
-- Added NOT VALID: it enforces on every future INSERT/UPDATE (the whole point — new rows must be a
-- push service) without scanning existing rows, so the migration can't hard-fail a deploy on some
-- pre-existing odd row. Any such legacy row is still caught at send time by the runtime guard.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_allowed;
-- ----------------------------------------------------------------------------

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_allowed check (
    endpoint ~* '^https://fcm\.googleapis\.com([/:?]|$)'
    or endpoint ~* '^https://updates\.push\.services\.mozilla\.com([/:?]|$)'
    or endpoint ~* '^https://(?:[a-z0-9-]+\.)+push\.apple\.com([/:?]|$)'
    or endpoint ~* '^https://(?:[a-z0-9-]+\.)+notify\.windows\.com([/:?]|$)'
  ) not valid;

comment on constraint push_subscriptions_endpoint_allowed on public.push_subscriptions is
  'SSRF guard (2026-07-21): endpoint must be one of the four real Web Push services (FCM / Apple / '
  'WNS / Mozilla). Mirrors isAllowedPushEndpoint in _shared/web-push.ts — keep the host list in sync.';
