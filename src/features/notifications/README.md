# notifications — proactive daily messaging (client)

The browser side of ADR-0031: opt-in Web Push for a morning **plan** and an evening **recap**, plus
the durable in-app inbox they land in. Server side (the dispatcher, guardrails, web-push crypto)
lives in `supabase/functions/` — see `supabase/functions/README.md`.

## Pieces

- **`use-push-subscription.ts`** — the opt-in: request the Notification permission, subscribe via the
  service worker's `PushManager` (public VAPID key `VITE_VAPID_PUBLIC_KEY`), and upsert the endpoint
  into `push_subscriptions` (owner RLS). `unsubscribe()` removes the row + the browser subscription.
  Reports browser support + an iOS "install to Home Screen first" hint (iOS only pushes to installed
  PWAs).
- **`NotificationSettings.tsx`** — the Settings consent section: the enable toggle (drives
  subscribe/unsubscribe) + morning/evening hour pickers + quiet hours. The prefs live in
  `user_schedule.config.notifications` (`ScheduleConfigSchema`), woven into the Settings draft so a
  normal save preserves them.
- **`use-messages.ts`** — the inbox data: `useMessages` (list), `useUnreadCount` (badge),
  `useMarkMessageRead` (`mark_message_read` RPC). `messages` is the source of truth; push is
  best-effort on top. Read via TanStack Query on load/focus (Realtime stays deferred, ADR-0021).
- **`NotificationBell.tsx` / `InboxPanel.tsx`** — the bell + unread badge in the app chrome and the
  message-list overlay. Opening a message deep-links into the chat (`#/chat/<id>`), which seeds it
  with the message and marks it read.

## Flow

Enable in Settings → permission + subscription stored → the hourly dispatcher
(`.github/workflows/notify.yml` → `dispatch-messages`) sends at the user's local morning/evening hour
→ the service worker (`src/sw.ts`) shows the notification → a tap opens the app at `#/chat/<id>`,
seeding the chat so the user can adjust todos in the two-way loop.

## Works without AI / without push

Every layer degrades: no VAPID key ⇒ the toggle says "not configured" and nothing subscribes; a
paused AI budget ⇒ the message is the deterministic version; a missed/blocked push ⇒ the message is
still in the inbox. Notifications are additive, never required.
