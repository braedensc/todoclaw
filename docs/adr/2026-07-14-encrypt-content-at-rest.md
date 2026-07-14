# ADR 2026-07-14 — At-rest encryption of chat / inbox / daily-plan content

**Date:** 2026-07-14 · **Post-launch** (privacy + DB-leak resistance)

The free-text, conversational content the app stores — BabyClaw transcripts, the proactive inbox
(morning plan / evening recap / reminders), and the persisted "Plan My Day" result — was stored as
**plaintext** `jsonb`/`text`. Row Level Security isolates one user's rows from another's, but RLS does
nothing against a **leaked logical dump**: a stolen backup, an over-permissioned replica dump, or an
accidental public backup bucket is fully readable prose ("call my lawyer about the settlement"). This
ADR encrypts those columns at rest so a dump is ciphertext.

## Decision 1 — encrypt the free-text content columns with pgcrypto + a Vault-held key

`20260714130000_encrypt_content_at_rest.sql` converts eight columns to `bytea` ciphertext and
backfills existing rows in place:

- `chat_messages.content` / `meta`, `chat_sessions.title` / `pending`
- `messages.title` / `body` / `data`
- `daily_state.plan`

Crypto is **pgcrypto PGP-symmetric** (`pgp_sym_encrypt`/`pgp_sym_decrypt` — random salt per call, so
equal plaintexts differ; MDC-authenticated). The symmetric key lives in **Supabase Vault**, whose root
key sits in the Postgres server config **outside the data tables and outside any logical dump**. The
key is **generated in-DB at migrate time** (`encode(gen_random_bytes(32),'base64')`, idempotent by
name) — there is no secret literal in the repo (Hard Rule #3); each environment auto-provisions its own.

pgsodium's Transparent Column Encryption is **deprecated** and deliberately **not** used.

## Decision 2 — decrypt only inside owner-scoped DEFINER RPCs; no decrypt oracle

All encrypt/decrypt happens inside `SECURITY DEFINER` helpers (`enc_text`/`dec_text`/`enc_jsonb`/
`dec_jsonb`, keyed from Vault) that are **revoked from every app role** — there is no generic decrypt
primitive an `authenticated` user (or a leaked anon key) can call to turn arbitrary ciphertext into
plaintext. Instead:

- **Writes** already flowed through `service_role` DEFINER RPCs (the `claim_message` /
  `chat_append_message` pattern); those now encrypt inline. `save_daily_plan` moves `INVOKER → DEFINER`
  so it can reach the Vault key — its `user_id = auth.uid()` fence is preserved, so the guarantee is
  identical.
- **Reads** switch from the client's direct `SELECT` to new **DEFINER read RPCs** that decrypt and
  re-check `user_id = auth.uid()` (`chat_load_messages`, `chat_list_sessions`, `chat_load_session`,
  `messages_list`, `daily_state_get`). Same PostgREST transport as the old select — **no new edge
  function**, reads stay cheap. Proven locally: ciphertext at rest leaks no plaintext, the owner reads
  it decrypted, and a second user reads **0** rows through every RPC.

## Threat model — what this does and does NOT do

- **DOES:** make a `pg_dump`/backup/stolen-disk logical snapshot useless without the Vault root key.
- **DOES:** preserve user↔user isolation exactly (RLS unchanged; every read RPC re-checks ownership).
- **DOES NOT:** hide content from the **operator**. Server-side AI (BabyClaw, Plan My Day) must read the
  plaintext to replay a transcript into the model window, so anyone holding `service_role` / the Vault
  root key can decrypt. **This is at-rest encryption, not end-to-end** — true E2E is incompatible with
  server-side AI over the same data.

## Scope — Tier A now; task/habit text is a deliberate follow-up

Encrypted here: the free-text **content** columns that the DB never filters/sorts/indexes on (verified:
no value-based index or CHECK on any of the eight). **Not** encrypted: `tasks.text` and habit names.
Those are the app's hot path — a task row's structural fields (`x`,`y`,`due`,`done`) must stay
queryable for the grid/clustering/scoring/date logic, and the free-text title is read on every load and
by four edge functions. Encrypting it is a larger, riskier change (main fetch → RPC, split write path,
per-edge-function decrypt) and gets its own PR.

## Consequences

- **Size CHECKs** re-added with headroom for PGP overhead (content ≤ 96 KiB, meta ≤ 24 KiB, pending ≤
  12 KiB); `bytea` is stored raw, not base64-expanded.
- **`messages.data`** is encrypted for completeness though nothing currently reads it (write-only today).
- **No Realtime impact** (ADR-0021 stays deferred): these reads are TanStack-Query fetches, now RPCs.
- **Backups (verified against `backup.yml` + `create_backup`):** the external `pg_dump` excludes
  `chat_sessions`, `chat_messages`, `assistant_memories` but **includes** `messages` and `daily_state`
  (now dumped as ciphertext, which is the point); `create_backup` snapshots only tasks/habits/schedule.
  So the two **chat tables have no row backup at all** — an offline key covers *key* loss, not *row*
  loss. Key backup/recovery + the chat row-backup gap are the subject of
  [`docs/RUNBOOK-KEY-RECOVERY.md`](RUNBOOK-KEY-RECOVERY.md) (the escrow is the pgcrypto passphrase, so
  recovery is independent of the Vault root key and survives project restores/PITR).
- Extends the persistent-chats security posture (ADR 2026-07-13): writes fenced server-side, reads
  owner-scoped, and now the data itself is opaque at rest.
