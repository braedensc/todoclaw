-- Migration: inbox ↔ chat consolidation (message-backed chat sessions)
--
-- Intent: opening an inbox message (a proactive plan/recap/reminder, ADR-0031) should open a REAL,
-- durable BabyClaw chat session FOR that message — not seed the shared conversation (which, since
-- persistent chats landed, auto-resumes an unrelated <24h session and appends the plan onto it). We
-- keep `messages` as the durable, idempotent (claim_message), externally-dumped, non-deletable inbox
-- source of truth — nothing about dispatch/backups/retention changes — and LAZILY materialise a
-- chat_session the first time the user opens a message. The link (`messages.session_id`) makes reopen
-- return the SAME session; the seeded assistant turn becomes real prior context (no more seed-wrapping).
--
-- The load-bearing security decision (persistent-chats ADR): the browser has NO write path to
-- chat_messages, so an assistant turn can never be forged. `chat_open_for_message` is the one
-- client-callable writer, and it preserves that invariant: the client passes ONLY a message id it
-- already owns, and the assistant content is derived SERVER-SIDE from that message's own title+body —
-- never from client input. So it can materialise "my own inbox message as an assistant turn" and
-- nothing else. It is SECURITY DEFINER (chat_messages has no authenticated INSERT grant) but fenced to
-- auth.uid() on every row it touches.
--
-- Proactive sessions are marked `origin='proactive'` (vs 'user') so they (a) never occupy the
-- human-chat 100-session cap, (b) never become the auto-resumed "most recent chat", and (c) render
-- with a bell in the unified history. `kind`/`local_date` carry the collar-tag + grouping metadata.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.chat_open_for_message(uuid);
--   alter table public.messages drop column if exists session_id;
--   -- restore the original cap check (counts ALL sessions):
--   create or replace function public.chat_sessions_cap_check() returns trigger language plpgsql
--     set search_path = public as $$ begin
--       if (select count(*) from public.chat_sessions where user_id = new.user_id) >= 100 then
--         raise exception 'chat_session_cap_reached' using errcode = 'P0001'; end if; return new; end $$;
--   alter table public.chat_sessions
--     drop column if exists origin, drop column if exists kind, drop column if exists local_date;
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Columns
-- ============================================================================

alter table public.chat_sessions
  add column origin     text not null default 'user' check (origin in ('user', 'proactive')),
  add column kind       text check (kind in ('plan', 'recap', 'reminder')),  -- null for user chats
  add column local_date date;                                                -- the message's local day

comment on column public.chat_sessions.origin is
  'user = a conversation the person started; proactive = materialised from an inbox message '
  '(BabyClaw-initiated). Proactive sessions are exempt from the human 100-session cap and the '
  'auto-resume slot, and render with a bell in the unified history.';

-- The inbox row a session was materialised from (null until first opened). ON DELETE SET NULL so a
-- (human-)deleted session simply un-links; the durable message stays and reopening re-materialises.
alter table public.messages
  add column session_id uuid references public.chat_sessions (id) on delete set null;

-- ============================================================================
-- Cap: count only human ('user') sessions so proactive materialisations never fill the budget.
-- ============================================================================

create or replace function public.chat_sessions_cap_check() returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only human-started conversations are bounded (this protects storage, not billing). Proactive
  -- rows are driven by the (already idempotent) inbox, so they are intentionally uncapped.
  if new.origin = 'user'
     and (select count(*) from public.chat_sessions
            where user_id = new.user_id and origin = 'user') >= 100 then
    raise exception 'chat_session_cap_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- ============================================================================
-- chat_open_for_message — materialise (or reopen) the session for one inbox message.
-- SECURITY DEFINER, granted to AUTHENTICATED (the client calls it directly), fenced to auth.uid().
-- ============================================================================

create or replace function public.chat_open_for_message(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_msg     public.messages;
  v_session uuid;
  v_label   text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- Lock the caller's own message row so two rapid opens (e.g. a double-tap, or a push tap racing the
  -- in-app click) serialise and share ONE session instead of creating duplicates.
  select * into v_msg
    from public.messages
    where id = p_message_id and user_id = v_uid
    for update;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;

  -- Already materialised (and still present) → reopen the same conversation.
  if v_msg.session_id is not null
     and exists (select 1 from public.chat_sessions where id = v_msg.session_id and user_id = v_uid) then
    return v_msg.session_id;
  end if;

  -- Fresh: create the proactive session, seed BabyClaw's message as its opening assistant turn, link.
  insert into public.chat_sessions (user_id, title, origin, kind, local_date)
  values (v_uid, nullif(btrim(left(v_msg.title, 80)), ''), 'proactive', v_msg.kind, v_msg.local_date)
  returning id into v_session;

  v_label := case v_msg.kind
    when 'plan' then 'morning plan'
    when 'recap' then 'evening recap'
    when 'reminder' then 'reminder'
    else 'update'
  end;

  -- TWO seed rows. (1) A DISPLAY-HIDDEN user turn (meta.hidden) that frames the context — it exists
  -- so the model window starts on a clean USER turn (loadWindow → windowMessages drops a *leading*
  -- assistant turn, which would otherwise strip the plan from the model's view of the first reply).
  -- rowsToChatItems skips meta.hidden rows, so the person never sees it. (2) BabyClaw's message as the
  -- opening ASSISTANT bubble. Both string contents are derived server-side from the user's OWN message
  -- — no client-supplied transcript content ever reaches chat_messages.
  insert into public.chat_messages (session_id, user_id, role, content, meta)
  values (
    v_session, v_uid, 'user',
    to_jsonb('The app just opened my ' || v_label || ' for me — I may want to adjust it.'),
    jsonb_build_object('hidden', true)
  );
  insert into public.chat_messages (session_id, user_id, role, content, meta)
  values (
    v_session, v_uid, 'assistant',
    to_jsonb(v_msg.title || E'\n\n' || v_msg.body),
    jsonb_build_object('origin', 'proactive')
  );

  update public.messages set session_id = v_session
    where id = p_message_id and user_id = v_uid;
  return v_session;
end;
$$;

comment on function public.chat_open_for_message(uuid) is
  'Materialise (or reopen) the BabyClaw chat session for one of the caller''s own inbox messages. '
  'DEFINER because chat_messages has no client INSERT grant; safe because the assistant turn is '
  'derived server-side from the caller''s own message, never client input. Fenced to auth.uid().';

-- App-facing: signed-in users open their own messages. DEFINER runs as owner; the auth.uid() fence
-- (not the grant) is what scopes it to the caller.
revoke all on function public.chat_open_for_message(uuid) from public;
grant execute on function public.chat_open_for_message(uuid) to authenticated;
