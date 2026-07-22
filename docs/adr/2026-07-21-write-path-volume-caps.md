# Write-path volume caps (non-AI storage-abuse hardening)

**Status:** Accepted

**Date:** 2026-07-21

## Context

RLS confines every user to their own rows, and the AI write path is already bounded
(chat_sessions/chat_messages cap triggers, assistant_memories 30-row trigger, guardrail RPCs).
The **non-AI** write path was not: a signed-in user with curl could insert a million task rows, a
100 MB `recurring` jsonb, or endless fabricated push endpoints. On the shared Supabase free tier,
storage exhaustion is a **whole-app outage** — boundedness here is an availability property, not a
UX quota. The 2026-07-06 audit also flagged the direct `task_reminders` INSERT grant as unused
(all app writes go through the reminder RPCs).

## Decision

Migration `20260721150000_write_path_volume_caps.sql` bounds the entire client-writable surface,
modeled on the existing cap-trigger pattern, with caps sized orders of magnitude above legit use:

- **Size CHECKs** — `char_length` on every free-text column (task/habit/history text 2000, matching
  BabyClaw's capability bound; bucket, timezone, backup label, push fields) and `pg_column_size` on
  every client-writable jsonb (`recurring`, `subtasks`, `config`, the daily_state maps + plan,
  `backups.data`). Text CHECKs are added VALID after an in-place clamp of any legacy over-cap value
  (else one oversized row fails all its own future UPDATEs, soft-delete included); jsonb CHECKs are
  `NOT VALID` (no lossless clamp exists, and the migration must not be able to fail on legacy data).
- **Per-user row-cap triggers** — tasks 2000 live / 10000 total, habits 200 / 1000 (two tiers
  because soft-delete churn is invisible to a live-only count), history 10000, reminders 8 per task
  / 2000 per user, backups 15, push subscriptions 20. All are **AFTER INSERT with `count > cap`**,
  a deliberate refinement of the earlier BEFORE/`>=` triggers: AFTER fires only for rows actually
  inserted, so every ON CONFLICT UPDATE path (restore_backup's upserts, `set_task_reminder`'s
  re-arm, push refresh) works unchanged at the cap. `restore_backup` itself is untouched — snapshot
  ids always still exist (nothing hard-deletes tasks/habits), so a restore is pure updates.
- **daily_state** — a ±14-day date **window** on insert/date-move instead of a row cap: rows are
  keyed one per (user, local day), so bounding writable dates bounds growth to ~one row per real
  day, forever.
- **task_reminders INSERT revoked** — `set_task_reminder` becomes SECURITY DEFINER with an explicit
  `user_id = auth.uid()` fence (the grant was load-bearing only because the RPC was INVOKER), then
  the direct grant + insert policy are dropped. UPDATE/DELETE grants stay for the INVOKER recompute
  triggers and remove/clear RPCs.
- **weather_cache_put** — key/payload length caps + a 500-row global cap with stale-first eviction
  (the DEFINER pair is that table's only write path).
- **Edge-function fetch bounds** — chat-context, `list_tasks`, and run-plan now `.limit()` their
  per-user selects (500 tasks / 250 habits / 1000 reminders, newest first — comfortably above the
  60/40 prompt render caps), so even an at-cap account can't balloon function memory or the model
  window.

Cap numbers live in `supabase/functions/_shared/write-caps.ts` and are pinned twice:
`write-caps.test.ts` (deno, literal pins + cross-invariants) and `src/lib/db-write-caps.test.ts`
(vitest, regex over the migration text so SQL and constants can't drift apart).

## Consequences

- A curl loop now stops at ~a few MB per user instead of the free-tier ceiling; every cap raises a
  named P0001 error (`task_cap_reached`, …) that surfaces through existing error paths.
- Caps are backstops, not quotas: no UI affordance warns near a cap (deliberate — legit use sits
  orders of magnitude below them). If one ever bites a real account, raise the number.
- The jsonb CHECKs stay `NOT VALID` until the owner runs the detection queries + `VALIDATE
  CONSTRAINT` statements listed in the migration header.
- A restore of a snapshot containing abuse-sized content fails atomically (no partial state) —
  accepted: post-migration snapshots can't contain such content.
