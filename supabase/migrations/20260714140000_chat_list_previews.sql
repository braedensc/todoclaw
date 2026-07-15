-- Migration: chat list previews (last-message snippet + user-visible message count)
--
-- Intent: the unified "Your chats" list (#272/#273) shows only a title and a relative time, so you
-- can't tell which conversation said what, nor which of BabyClaw's check-ins you actually replied to
-- versus merely received. This adds ONE read that returns, per session, the last user-visible message
-- (role + content + meta) and the count of user-visible messages. The list renders a truncated preview
-- line from the former and a reply-count badge from the latter.
--
-- Why an RPC rather than a select: PostgREST cannot express "latest row per session" (no DISTINCT ON),
-- so the alternatives are N+1 requests or fetching every transcript to compute it client-side —
-- pulling the entire chat history into the browser to render 50 one-line snippets.
--
-- SECURITY DEFINER here buys ONE round-trip shape, not new reach: the client already holds SELECT on
-- chat_messages under RLS, so this exposes nothing it could not already read. It is fenced to
-- auth.uid() on every row, and the session window is itself fenced to auth.uid() — p_limit can only
-- ever slice the caller's own sessions.
--
-- HIDDEN TURNS (the load-bearing detail): a proactive session opens with a server-seeded framing turn
-- (meta.hidden — see chat_open_for_message) that primes the model but is never rendered. It is
-- excluded from BOTH the count and the "last message" pick. Otherwise every freshly-opened check-in
-- would report 2 messages and read as "you replied" when you have not, and a preview could surface
-- framing text the person never wrote.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal):
--   drop function if exists public.chat_list_previews(int);
-- ----------------------------------------------------------------------------

create or replace function public.chat_list_previews(p_limit int default 50)
returns table (
  session_id   uuid,
  msg_count    int,
  last_role    text,
  last_content jsonb,
  last_meta    jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  -- The sessions the list can actually render, which is TWO sets, not one: the caller's most-recent
  -- conversations, plus the sessions behind their most-recent inbox check-ins. The list draws those
  -- check-in rows from `messages`, so their session's updated_at can sit outside the window above —
  -- and a session with no preview row reports 0 messages, i.e. an old check-in you HAD replied to
  -- would silently lose its badge and read as untouched. The second arm closes that.
  with mine as (
    (select s.id
       from public.chat_sessions s
      where s.user_id = auth.uid()
      order by s.updated_at desc
      limit greatest(coalesce(p_limit, 50), 0))
    union
    (select m.session_id
       from public.messages m
      where m.user_id = auth.uid()
        and m.session_id is not null
      order by m.created_at desc
      limit 10)  -- headroom over the list's MAX_PROACTIVE of 3
  )
  -- Window functions are evaluated before DISTINCT ON, so msg_count sees the whole (filtered)
  -- partition while the row itself is the newest surviving turn. Every reference is alias-qualified:
  -- the RETURNS TABLE column names are in scope here and would otherwise be ambiguous.
  select distinct on (m.session_id)
    m.session_id,
    (count(*) over (partition by m.session_id))::int,
    m.role::text,
    m.content,
    m.meta
  from public.chat_messages m
  join mine on mine.id = m.session_id
  where m.user_id = auth.uid()
    and not coalesce((m.meta ->> 'hidden')::boolean, false)
  order by m.session_id, m.seq desc
$$;

comment on function public.chat_list_previews(int) is
  'Per-session last user-visible message + count, for the "Your chats" preview line and reply badge. '
  'DEFINER for one round-trip (the client already has RLS SELECT on chat_messages — no new reach); '
  'fenced to auth.uid(). Server-seeded hidden framing turns are excluded from both the count and the '
  'last-message pick, so a freshly-opened proactive session correctly reports 1 message, not 2.';

-- DEFINER + the auth.uid() fence inside the body is what scopes this to the caller; the grant only
-- decides who may ask.
revoke all on function public.chat_list_previews(int) from public;
grant execute on function public.chat_list_previews(int) to authenticated;
