-- Migration: encrypt_content_at_rest
--
-- Intent: encrypt the FREE-TEXT / conversational content columns AT REST so a leaked logical DB dump
--   (a stolen backup, an over-permissioned replica dump, an accidental public backup bucket) is
--   ciphertext, not readable plaintext. This covers the four content surfaces:
--     • chat transcripts    — chat_messages.content / meta, chat_sessions.title / pending
--     • proactive inbox     — messages.title / body / data (the daily plan/recap + reminder text)
--     • daily "Plan My Day"  — daily_state.plan
--
-- THREAT MODEL (what this does and does NOT do):
--   • DOES: make a `pg_dump` / backup / stolen-disk logical snapshot useless without the key. The key
--     lives in Supabase Vault, encrypted by a root key held in the Postgres server config — OUTSIDE
--     the data tables and OUTSIDE any logical dump. Dump the public schema → ciphertext only.
--   • DOES: keep user↔user isolation exactly as before (RLS is unchanged; every read RPC re-checks
--     user_id = auth.uid()).
--   • DOES NOT: hide content from the OPERATOR. Server-side AI (BabyClaw, Plan My Day) must read the
--     plaintext to replay a transcript into the model window, so the server (and thus anyone holding
--     the Vault root key / service_role) can always decrypt. True end-to-end encryption is
--     incompatible with server-side AI — this is at-rest encryption, not E2E. See the ADR.
--
-- KEY MANAGEMENT: the symmetric key is GENERATED IN-DB at migration time (encode(gen_random_bytes(32),
--   'base64')) and stored via vault.create_secret — there is NO secret literal in this file (Hard Rule
--   #3). Each environment (local, CI, prod) auto-provisions its own key on first migrate; a `db reset`
--   regenerates it against an empty schema. The create is guarded by name so it is idempotent and
--   never rotates an existing key out from under encrypted data. Because of that name-guard, an
--   operator can PRE-SEED their own key (kept offline) before the first migrate and it is adopted
--   verbatim. BACK UP THE PROD KEY OFFLINE: losing it makes the ciphertext unrecoverable. Full
--   backup/recovery procedure — and the chat row-backup gap — in docs/RUNBOOK-KEY-RECOVERY.md.
--
-- PATTERN: pgcrypto PGP-symmetric (pgp_sym_encrypt/decrypt — random salt per call, so equal plaintexts
--   yield different ciphertext; authenticated via MDC). pgsodium's Transparent Column Encryption is
--   DEPRECATED and deliberately NOT used. All encrypt/decrypt happens inside SECURITY DEFINER helpers
--   that are REVOKED from every app role — there is no generic decrypt oracle. The content columns
--   become `bytea`; the write RPCs (already service_role-fenced) encrypt on the way in, and NEW
--   owner-scoped read RPCs decrypt on the way out. Clients switch their direct SELECTs to these RPCs
--   (same PostgREST transport — no new edge function, reads stay cheap).
--
-- pgcrypto lives in the `extensions` schema on Supabase, so every crypto call below is
--   fully-qualified (extensions.pgp_sym_encrypt / extensions.gen_random_bytes) and the helpers pin a
--   search_path that includes it.
--
-- ----------------------------------------------------------------------------
-- Down path (manual reversal — decrypt back to plaintext, then drop helpers/key). Sketch:
--   -- for each column: add plaintext col, backfill = dec_*(col), drop bytea col, rename back, re-add
--   --   the original NOT NULL / size CHECK. Then restore the pre-encryption RPC bodies from git.
--   drop function if exists public.chat_load_messages(uuid, int);
--   drop function if exists public.chat_list_sessions(int);
--   drop function if exists public.chat_load_session(uuid);
--   drop function if exists public.messages_list(int);
--   drop function if exists public.daily_state_get(date);
--   drop function if exists public.enc_text(text); drop function if exists public.dec_text(bytea);
--   drop function if exists public.enc_jsonb(jsonb); drop function if exists public.dec_jsonb(bytea);
--   drop function if exists public._content_key();
--   delete from vault.secrets where name = 'content_enc_key';
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 0. Extensions (both already present on the Supabase platform; assert for local/CI)
-- ============================================================================
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault;

-- ============================================================================
-- 1. The content-encryption key — generated in-DB, stored in Vault, idempotent by name.
-- ============================================================================
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'content_enc_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'content_enc_key',
      'Symmetric key for at-rest encryption of chat/inbox/daily-plan content (encrypt_content_at_rest).'
    );
  end if;
end $$;

-- ============================================================================
-- 2. Crypto helpers — SECURITY DEFINER, REVOKED from every app role (no decrypt oracle). Only the
--    higher-level DEFINER RPCs below (owned by the same role) call these; app roles never can.
-- ============================================================================

-- Fetch the raw key (base64 passphrase) from Vault. stable: same value within a statement.
create or replace function public._content_key()
returns text
language sql
stable
security definer
set search_path = public, extensions, vault, pg_temp
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'content_enc_key' limit 1;
$$;

create or replace function public.enc_text(p text)
returns bytea
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select case when p is null then null
              else extensions.pgp_sym_encrypt(p, public._content_key()) end;
$$;

create or replace function public.dec_text(p bytea)
returns text
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select case when p is null then null
              else extensions.pgp_sym_decrypt(p, public._content_key()) end;
$$;

create or replace function public.enc_jsonb(p jsonb)
returns bytea
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select case when p is null then null
              else extensions.pgp_sym_encrypt(p::text, public._content_key()) end;
$$;

create or replace function public.dec_jsonb(p bytea)
returns jsonb
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select case when p is null then null
              else extensions.pgp_sym_decrypt(p, public._content_key())::jsonb end;
$$;

-- No app role may call the crypto primitives directly — they are internal to the DEFINER RPCs.
revoke all on function public._content_key()  from public, anon, authenticated;
revoke all on function public.enc_text(text)  from public, anon, authenticated;
revoke all on function public.dec_text(bytea) from public, anon, authenticated;
revoke all on function public.enc_jsonb(jsonb) from public, anon, authenticated;
revoke all on function public.dec_jsonb(bytea) from public, anon, authenticated;

-- ============================================================================
-- 3. Column type changes (jsonb/text -> bytea) with in-place backfill-encrypt of existing rows.
--    Pattern per column: add bytea sibling, backfill = enc_*(old), (re-assert NOT NULL), drop old
--    (its size CHECK drops with it), rename. Size CHECKs are re-added with headroom for ciphertext
--    (PGP adds a small fixed overhead; bytea is stored raw, not base64-expanded).
-- ============================================================================

-- ---- chat_messages.content (jsonb NOT NULL) + meta (jsonb, nullable) -----------------------------
alter table public.chat_messages add column content_enc bytea;
update public.chat_messages set content_enc = public.enc_jsonb(content);
alter table public.chat_messages alter column content_enc set not null;
alter table public.chat_messages drop column content;                 -- drops chat_messages_content_size
alter table public.chat_messages rename column content_enc to content;

alter table public.chat_messages add column meta_enc bytea;
update public.chat_messages set meta_enc = public.enc_jsonb(meta);
alter table public.chat_messages drop column meta;                    -- drops chat_messages_meta_size
alter table public.chat_messages rename column meta_enc to meta;

alter table public.chat_messages
  add constraint chat_messages_content_size check (pg_column_size(content) <= 98304),
  add constraint chat_messages_meta_size    check (meta is null or pg_column_size(meta) <= 24576);

-- ---- chat_sessions.title (text, nullable) + pending (jsonb, nullable) ----------------------------
alter table public.chat_sessions add column title_enc bytea;
update public.chat_sessions set title_enc = public.enc_text(title);
alter table public.chat_sessions drop column title;
alter table public.chat_sessions rename column title_enc to title;

alter table public.chat_sessions add column pending_enc bytea;
update public.chat_sessions set pending_enc = public.enc_jsonb(pending);
alter table public.chat_sessions drop column pending;                -- drops chat_sessions_pending_size
alter table public.chat_sessions rename column pending_enc to pending;

alter table public.chat_sessions
  add constraint chat_sessions_pending_size check (pending is null or pg_column_size(pending) <= 12288);

-- ---- messages.title (text NOT NULL) + body (text NOT NULL) + data (jsonb, nullable) --------------
alter table public.messages add column title_enc bytea;
update public.messages set title_enc = public.enc_text(title);
alter table public.messages alter column title_enc set not null;
alter table public.messages drop column title;
alter table public.messages rename column title_enc to title;

alter table public.messages add column body_enc bytea;
update public.messages set body_enc = public.enc_text(body);
alter table public.messages alter column body_enc set not null;
alter table public.messages drop column body;
alter table public.messages rename column body_enc to body;

alter table public.messages add column data_enc bytea;
update public.messages set data_enc = public.enc_jsonb(data);
alter table public.messages drop column data;
alter table public.messages rename column data_enc to data;

-- ---- daily_state.plan (jsonb, nullable) ---------------------------------------------------------
alter table public.daily_state add column plan_enc bytea;
update public.daily_state set plan_enc = public.enc_jsonb(plan);
alter table public.daily_state drop column plan;
alter table public.daily_state rename column plan_enc to plan;

-- ============================================================================
-- 4. Rewrite the WRITE RPCs to encrypt (each already service_role/DEFINER-fenced; bodies otherwise
--    unchanged from their prior migrations — see cites). save_daily_plan additionally moves to
--    SECURITY DEFINER so it can reach the Vault key; its owner-scoping (user_id = auth.uid()) is
--    preserved, so the guarantee is identical.
-- ============================================================================

-- chat_append_message (20260713050000_chat_sessions.sql): encrypt content + meta.
create or replace function public.chat_append_message(
  p_session uuid,
  p_user_id uuid,
  p_role    text,
  p_content jsonb,
  p_meta    jsonb default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  if p_role not in ('user', 'assistant') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.chat_sessions where id = p_session and user_id = p_user_id
  ) then
    raise exception 'chat_session_not_found' using errcode = 'P0002';
  end if;
  insert into public.chat_messages (session_id, user_id, role, content, meta)
  values (p_session, p_user_id, p_role, public.enc_jsonb(p_content), public.enc_jsonb(p_meta))
  returning seq into v_seq;
  update public.chat_sessions set updated_at = now() where id = p_session;
  return v_seq;
end;
$$;

-- chat_start_session (20260713050000_chat_sessions.sql): encrypt title.
create or replace function public.chat_start_session(
  p_user_id uuid,
  p_title   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.chat_sessions (user_id, title)
  values (p_user_id, public.enc_text(nullif(btrim(p_title), '')))
  returning id into v_id;
  return v_id;
end;
$$;

-- chat_set_pending (20260713050000_chat_sessions.sql): encrypt pending.
create or replace function public.chat_set_pending(
  p_session uuid,
  p_user_id uuid,
  p_pending jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions
    set pending = public.enc_jsonb(p_pending), updated_at = now()
    where id = p_session and user_id = p_user_id;
  if not found then
    raise exception 'chat_session_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- claim_message (latest def: 20260709033335_task_reminders_pipeline.sql): encrypt title/body/data.
-- Keeps the partial-index ON CONFLICT arbiter so daily idempotency is unchanged.
create or replace function public.claim_message(
  p_user_id    uuid,
  p_kind       text,
  p_local_date date,
  p_title      text,
  p_body       text,
  p_data       jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.messages (user_id, kind, local_date, title, body, data)
  values (p_user_id, p_kind, p_local_date,
          public.enc_text(p_title), public.enc_text(p_body), public.enc_jsonb(p_data))
  on conflict (user_id, local_date, kind) where kind in ('plan', 'recap') do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- insert_reminder_message (20260709033335_task_reminders_pipeline.sql): encrypt title/body/data.
create or replace function public.insert_reminder_message(
  p_user_id    uuid,
  p_local_date date,
  p_title      text,
  p_body       text,
  p_data       jsonb default null
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.messages (user_id, kind, local_date, title, body, data)
  values (p_user_id, 'reminder', p_local_date,
          public.enc_text(p_title), public.enc_text(p_body), public.enc_jsonb(p_data))
  returning id;
$$;

-- enrich_message (20260708000000_dispatch_plan_content.sql): encrypt title/body. Freshness predicate
-- unchanged (only a message from the last hour — i.e. this dispatch run's — can be upgraded).
create or replace function public.enrich_message(p_id uuid, p_title text, p_body text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.messages
    set title = public.enc_text(p_title), body = public.enc_text(p_body)
    where id = p_id
      and created_at > now() - interval '1 hour';
$$;

-- save_daily_plan (20260703000000_daily_plan.sql): encrypt plan. NOW SECURITY DEFINER (was INVOKER) so
-- it can read the Vault key; still scoped to auth.uid() on both the insert and the update, so a caller
-- can only ever write their OWN row — identical guarantee, just moved off RLS onto the explicit fence.
create or replace function public.save_daily_plan(
  p_date date,
  p_plan jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_state (user_id, date)
  values (auth.uid(), p_date)
  on conflict (user_id, date) do nothing;

  update public.daily_state
  set plan = public.enc_jsonb(p_plan)
  where user_id = auth.uid()
    and date = p_date;
end;
$$;

-- save_daily_plan_for_user (20260707140000_ai_guardrails_system_rpcs.sql): encrypt plan.
create or replace function public.save_daily_plan_for_user(
  p_user_id uuid,
  p_date    date,
  p_plan    jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.daily_state (user_id, date)
  values (p_user_id, p_date)
  on conflict (user_id, date) do nothing;

  update public.daily_state
  set plan = public.enc_jsonb(p_plan)
  where user_id = p_user_id
    and date = p_date;
end;
$$;

-- dispatch_inputs_for_user (20260708000000_dispatch_plan_content.sql): DECRYPT plan on read so the
-- evening-recap builder still sees a DayPlan. Only the plan read changes; the rest is a straight
-- restatement so this file's version wins. (Redefined in full to keep the body authoritative.)
create or replace function public.dispatch_inputs_for_user(p_user_id uuid, p_local_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config     jsonb;
  v_tasks      jsonb;
  v_habits     jsonb;
  v_done       jsonb;
  v_habit_done jsonb;
  v_plan       jsonb;
begin
  select config into v_config from public.user_schedule where user_id = p_user_id;

  select coalesce(
           jsonb_agg(to_jsonb(t) order by t.created_at)
             filter (where t.id is not null),
           '[]'::jsonb
         )
    into v_tasks
    from public.tasks t
    where t.user_id = p_user_id and t.deleted_at is null and t.completed_at is null;

  select coalesce(
           jsonb_agg(to_jsonb(h) order by h.created_at)
             filter (where h.id is not null),
           '[]'::jsonb
         )
    into v_habits
    from public.habits h
    where h.user_id = p_user_id and h.deleted_at is null;

  select done, habit_done, public.dec_jsonb(plan) into v_done, v_habit_done, v_plan
    from public.daily_state
    where user_id = p_user_id and date = p_local_date;

  return jsonb_build_object(
    'config', coalesce(v_config, '{}'::jsonb),
    'tasks', v_tasks,
    'habits', v_habits,
    'done', coalesce(v_done, '{}'::jsonb),
    'habit_done', coalesce(v_habit_done, '{}'::jsonb),
    'plan', v_plan
  );
end;
$$;

-- chat_open_for_message (20260714120000_inbox_chat_sessions.sql): the cross-column boundary. Reads the
-- caller's own message (title/body now ciphertext → DECRYPT to build the seed), writes the session
-- title + the two seed turns ENCRYPTED. Assistant content is still derived server-side from the
-- caller's OWN message — no client transcript input — so the no-forgery invariant holds unchanged.
create or replace function public.chat_open_for_message(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_msg       public.messages;
  v_session   uuid;
  v_label     text;
  v_title     text;
  v_body      text;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_msg
    from public.messages
    where id = p_message_id and user_id = v_uid
    for update;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;

  if v_msg.session_id is not null
     and exists (select 1 from public.chat_sessions where id = v_msg.session_id and user_id = v_uid) then
    return v_msg.session_id;
  end if;

  v_title := public.dec_text(v_msg.title);   -- decrypt once for reuse
  v_body  := public.dec_text(v_msg.body);

  insert into public.chat_sessions (user_id, title, origin, kind, local_date)
  values (v_uid, public.enc_text(nullif(btrim(left(v_title, 80)), '')),
          'proactive', v_msg.kind, v_msg.local_date)
  returning id into v_session;

  v_label := case v_msg.kind
    when 'plan' then 'morning plan'
    when 'recap' then 'evening recap'
    when 'reminder' then 'reminder'
    else 'update'
  end;

  insert into public.chat_messages (session_id, user_id, role, content, meta)
  values (
    v_session, v_uid, 'user',
    public.enc_jsonb(to_jsonb('The app just opened my ' || v_label || ' for me — I may want to adjust it.')),
    public.enc_jsonb(jsonb_build_object('hidden', true))
  );
  insert into public.chat_messages (session_id, user_id, role, content, meta)
  values (
    v_session, v_uid, 'assistant',
    public.enc_jsonb(to_jsonb(v_title || E'\n\n' || v_body)),
    public.enc_jsonb(jsonb_build_object('origin', 'proactive'))
  );

  update public.messages set session_id = v_session
    where id = p_message_id and user_id = v_uid;
  return v_session;
end;
$$;

-- ============================================================================
-- 5. New DECRYPTING read RPCs — SECURITY DEFINER, each re-checks user_id = auth.uid() (RLS-equivalent
--    ownership), granted to authenticated. These REPLACE the clients' former direct SELECTs of the
--    now-ciphertext columns. No generic decrypt is exposed; each returns ONLY the caller's own rows.
-- ============================================================================

-- Transcript for one session (oldest-first). p_limit takes the NEWEST N (for the model window);
-- null = all (for full history hydration). Ownership: the session must be the caller's.
create or replace function public.chat_load_messages(p_session uuid, p_limit int default null)
returns table (seq bigint, role text, content jsonb, meta jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select w.seq, w.role, public.dec_jsonb(w.content), public.dec_jsonb(w.meta)
  from (
    select m.seq, m.role, m.content, m.meta
    from public.chat_messages m
    join public.chat_sessions s on s.id = m.session_id
    where m.session_id = p_session
      and s.user_id = auth.uid()
    order by m.seq desc
    limit coalesce(p_limit, 2147483647)
  ) w
  order by w.seq asc;
$$;

-- The history list (newest-first). Decrypts title + pending; other columns are plaintext metadata.
create or replace function public.chat_list_sessions(p_limit int default 50)
returns table (
  id         uuid,
  title      text,
  updated_at timestamptz,
  origin     text,
  kind       text,
  local_date date,
  pending    jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, public.dec_text(s.title), s.updated_at, s.origin, s.kind, s.local_date,
         public.dec_jsonb(s.pending)
  from public.chat_sessions s
  where s.user_id = auth.uid()
  order by s.updated_at desc
  limit p_limit;
$$;

-- One session's pending (halted-confirmation) state, decrypted. Zero rows when not the caller's
-- (so the edge loader can 404). Used by the edge resume path.
create or replace function public.chat_load_session(p_session uuid)
returns table (pending jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select public.dec_jsonb(s.pending)
  from public.chat_sessions s
  where s.id = p_session and s.user_id = auth.uid();
$$;

-- The inbox list (newest-first). Decrypts title + body; data stays encrypted (nothing reads it).
create or replace function public.messages_list(p_limit int default 50)
returns table (
  id         uuid,
  kind       text,
  local_date date,
  title      text,
  body       text,
  read_at    timestamptz,
  created_at timestamptz,
  session_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.kind, m.local_date, public.dec_text(m.title), public.dec_text(m.body),
         m.read_at, m.created_at, m.session_id
  from public.messages m
  where m.user_id = auth.uid()
  order by m.created_at desc
  limit p_limit;
$$;

-- Today's daily_state for the caller, with plan DECRYPTED. Returns the shape DailyStateSchema parses
-- (the completion maps + plan); null when there is no row for the day (client → empty state).
create or replace function public.daily_state_get(p_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'user_id',      ds.user_id,
    'date',         ds.date,
    'done',         coalesce(ds.done, '{}'::jsonb),
    'done_at',      coalesce(ds.done_at, '{}'::jsonb),
    'habit_done',   coalesce(ds.habit_done, '{}'::jsonb),
    'subtask_done', coalesce(ds.subtask_done, '{}'::jsonb),
    'plan',         public.dec_jsonb(ds.plan)
  )
  from public.daily_state ds
  where ds.user_id = auth.uid() and ds.date = p_date;
$$;

-- Grants: these read RPCs are app-facing (authenticated), each fenced to auth.uid() internally. The
-- interactive chat context (chat-context.ts) reads the decrypted plan through daily_state_get under
-- the caller JWT; the proactive/dispatch path decrypts the plan inline inside dispatch_inputs_for_user
-- (service_role) — so no separate service-role plan reader is needed.
grant execute on function public.chat_load_messages(uuid, int) to authenticated;
grant execute on function public.chat_list_sessions(int)       to authenticated;
grant execute on function public.chat_load_session(uuid)       to authenticated;
grant execute on function public.messages_list(int)            to authenticated;
grant execute on function public.daily_state_get(date)         to authenticated;
