-- Migration: history_delete_policy
--
-- Intent: let a user DELETE their own history rows from the Done tab.
--
-- Background: history was created SELECT + INSERT only — no UPDATE, no DELETE, no
-- update/delete policy — on the theory that a completion log should be immutable/append-only
-- (see 20260624000000_history_and_daily_state_rpc.sql and ADR-0012). In practice the Done
-- tab's ✕ soft-deleted the underlying TASK while leaving the history row in place, which read
-- to the user as "nothing happened" (the done task was already hidden from the grid). The
-- Done-tab rework (feat/done-popup-rework) re-points ✕ at the completion RECORD — it removes
-- the history row from the list, matching the original EisenClaw ✕ behavior — so history needs
-- an owner-scoped DELETE path.
--
-- Scope: DELETE is owner-scoped exactly like SELECT (user_id = auth.uid()) — a user can only
-- remove their OWN completions. INSERT is unchanged (still only via set_task_done). There is
-- still NO UPDATE grant/policy (a row is never edited, only added or removed).
--
-- This makes history NO LONGER append-only/immutable. The "History = permanent log" invariant
-- in CLAUDE.md, ADR-0012, and the done README is updated in the same PR.
--
-- Down path (manual reversal):
--   drop policy if exists "history_delete_own" on public.history;
--   revoke delete on public.history from authenticated;

grant delete on public.history to authenticated;

create policy "history_delete_own"
  on public.history for delete
  to authenticated
  using (user_id = auth.uid());

comment on table public.history is
  'Completion log behind the Done tab, newest-first. Denormalized (text/bucket snapshotted on '
  'the row, task_id has no FK) so completions survive task soft-delete. Owner-scoped SELECT / '
  'INSERT / DELETE (no UPDATE): a user may remove their own completions from the Done tab, but '
  'rows are never edited in place.';
