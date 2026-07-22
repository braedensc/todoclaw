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
  `useMarkMessageRead` (`mark_message_read` RPC), `useMarkAllMessagesRead` (bulk — an RLS-scoped
  `read_at` update, no RPC). `messages` is the source of truth; push is best-effort on top. Read via
  TanStack Query on load/focus (Realtime stays deferred, ADR-0021).
- The unread badge and message list live in the **chat drawer** now (the separate bell/inbox overlay
  was retired): the desktop "Chat N" badge and the mobile Chat-tab dot surface `useUnreadCount`, and
  `ChatSessionList` (`src/features/ai`) lists check-ins under "From BabyClaw" — unread rows are
  exempt from its display cap and carry per-row dots, with a "Mark all read" bulk action on the
  group label. Opening a message materialises/reopens its chat session and marks it read.

## Flow

Enable in Settings → permission + subscription stored → the hourly dispatcher
(`.github/workflows/notify.yml` → `dispatch-messages`) sends at the user's local morning/evening hour
→ the service worker (`src/sw.ts`) shows the notification → a tap opens the app at `#/chat/<id>`,
seeding the chat so the user can adjust todos in the two-way loop.

## Works without AI / without push

Every layer degrades: no VAPID key ⇒ the toggle says "not configured" and nothing subscribes; a
paused AI budget ⇒ the message is the deterministic version; a missed/blocked push ⇒ the message is
still in the inbox. Notifications are additive, never required.
