# ADR-0021 — Realtime re-deferred past Stage 5

**Date:** 2026-07-02 · **Stage:** 5

ADR-0013 deferred Supabase Realtime "to Stage 5". Revisited in Stage 5 and **re-deferred**
(Braeden's call, 2026-07-02):

- **Why it stays out.** RLS scopes every user to their own rows, so Realtime would only sync the
  *same* user across two devices at once — a narrow case for an invite-only MVP. TanStack Query's
  `refetchOnWindowFocus` / `refetchOnReconnect` plus date-keyed `daily_state` already cover the
  common flows, and Stage 6 (ship) is running in parallel; adding a new always-on async actor now
  would complicate that and add flake risk to the golden suite for little user-visible gain.
- **Why waiting is free.** The Stage 3 atomic merge-RPCs (ADR-0013) mean a future Realtime push
  reflects a consistent row with no client-merge reconciliation to retrofit — adoption stays purely
  additive (a subscription that invalidates queries and ignores own-client echoes). Revisit when
  multi-device concurrency or real multi-tenant sharing (Stage 7) makes it worth the moving part.
- **Invariant unchanged:** the planner remains fully usable without it.
