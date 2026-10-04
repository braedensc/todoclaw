# Runbook — content encryption key: backup & recovery

Companion to ADR `2026-07-14-encrypt-content-at-rest`. This is the operator's guide to making sure
at-rest encryption can **never** cause permanent data loss, and to holding an **offline backup key**.

Helper script: [`scripts/encryption-key.sh`](../scripts/encryption-key.sh) encodes every procedure
below safely (verify-before-destroy). Prefer it over hand-run SQL.

---

## TL;DR

- Content (chats, inbox, daily plans) is encrypted at rest with **pgcrypto**. The key is a single
  **base64 string** (32 random bytes) stored in Supabase **Vault** under the name `content_enc_key`.
- **Hold an offline copy of that string** (password manager) and any key loss is a one-command
  recovery — proven: delete the Vault secret → data unreadable → re-create it with the saved string →
  the *exact same ciphertext* decrypts again. The escrow is the pgcrypto **passphrase**, independent
  of Supabase's internal Vault root key, so it survives project restores, PITR, and pgsodium's
  deprecation.
- **BUT an offline key is not a row backup.** It restores *readability*, never *existence*. See
  [Key loss vs row loss](#key-loss-vs-row-loss) — this is the part that actually needs your attention.
- The external backup path needs **two** offline secrets: `content_enc_key` **and**
  `BACKUP_GPG_PASSPHRASE` (the dump's outer AES-256 envelope). Escrow both.

---

## The one rule that prevents disaster

> **Never delete or overwrite the Vault key until `pgp_sym_decrypt` with your escrowed string has
> returned plaintext from a real row.**

Because `vault.secrets` has a unique index on `name`, `vault.create_secret('…','content_enc_key',…)`
**fails loudly** if a key already exists — it cannot silently clobber. The only way to lose data
during recovery is to `delete` the working key *first* and *then* install a wrong escrow (a one-byte
mismatch — e.g. a stray trailing newline — or the wrong environment's key). The read-only decrypt test
in [Procedure 3](#procedure-3--verify-your-escrow-non-destructive) is the gate; run it before any
Vault change.

---

## Key loss vs row loss

The offline key covers exactly one failure class. Know the boundary:

| Failure | Offline key recovers it? | What actually saves you |
|---|---|---|
| Vault secret `content_enc_key` deleted | ✅ yes | re-seed the escrowed string ([Proc 4](#procedure-4--recover-from-a-lostwrong-key-verify-gated)) |
| Vault root key lost / project rebuilt / restore into a **new** project (migrated secret is opaque) | ✅ yes | re-seed the escrowed string |
| Backup restored into an env that auto-generated a **different** key | ✅ yes | replace it with the escrowed string |
| An encrypted **column is dropped** | ❌ no | a **row backup** / PITR — the ciphertext is gone |
| **Rows** deleted / truncated / table dropped / `db reset` against prod / CASCADE | ❌ no | a **row backup** / PITR — no key can un-delete a row |
| A ciphertext value is **corrupted** (one byte) | ❌ no | a row backup — pgcrypto is all-or-nothing, a single bad byte fails the whole value |

**A key can only decrypt rows that still physically exist.** Encryption adds exactly one new
permanent-loss risk — *key* loss — which the offline copy fully closes. Everything below the line is
ordinary DB loss, unchanged by encryption, and is the job of DB backups.

### ⚠️ Row-backup gap (known & accepted, 2026-07-14)

Row-backup coverage of the four encrypted tables **today**:

| Table | In external dump (`backup.yml`, GPG) | In `create_backup` |
|---|---|---|
| `messages` | ✅ (ciphertext) | ❌ |
| `daily_state` | ✅ (ciphertext) | ❌ |
| `chat_sessions` | ❌ **excluded** | ❌ |
| `chat_messages` | ❌ **excluded** | ❌ |

**Your BabyClaw chat transcripts are in no backup at all** — they're excluded from the external dump
(a deliberate "delete means delete" privacy choice) and `create_backup` only snapshots
tasks/habits/schedule. So a dropped/truncated chat is gone regardless of the key.

**Current decision (2026-07-14): accept this** — chats are treated as ephemeral AI meta, consistent
with "delete means delete", and messages/daily_state remain covered by the external dump. If that
calculus changes, close the gap with either:

1. **Enable Supabase managed daily backups / PITR** (Dashboard → Database → Backups). Covers every
   table in-place, independent of the app. The general row-loss safety net.
2. **Stop excluding chats from the external dump** (remove the two `--exclude-table` lines in
   `.github/workflows/backup.yml`). They'd dump as *ciphertext*, so the privacy exposure is bounded —
   but it partly reverses the "deleted chats don't linger in rotated dumps" stance.

---

## Procedure 1 — Provision your own key *before* encryption goes live (recommended)

Best path while PR #274 is unmerged: create the key yourself so escrow exists from moment zero — no
window where real content is encrypted under a key that lives in only one place. The migration's
`if not exists (… where name='content_enc_key')` guard adopts a pre-existing key verbatim (verified).

```bash
# 1. Generate a valid key (32 random bytes, base64 — same shape the migration would generate).
#    tr -d '\n' is REQUIRED: pgcrypto is byte-exact and openssl appends a newline.
openssl rand -base64 32 | tr -d '\n'; echo
# 2. Store the printed string in your password manager, labelled with the prod project-ref + today's date.
# 3. In PROD (before merging #274), install it:  (psql preferred over the Studio SQL editor — see note)
psql "$PROD_DB_URL" -c "select vault.create_secret('<KEY_FROM_STEP_1>','content_enc_key','operator-provisioned');"
# 4. Merge #274. The migration sees the key exists, SKIPS generation, and backfills under YOUR key.
# 5. Run Procedure 3 against prod to confirm your escrow matches what encrypted the data.
```

Do **not** pre-seed local/CI with this value — let them auto-generate throwaway keys; only prod's key
is escrowed.

## Procedure 2 — Export the key (if it was auto-generated)

If #274 already deployed and auto-generated the prod key, export it immediately:

```bash
psql "$PROD_DB_URL" -Atc "select decrypted_secret from vault.decrypted_secrets where name='content_enc_key';"
```

Copy the single 44-char string (ends in `=`) into your password manager, labelled with the prod
project-ref + date. `helper: scripts/encryption-key.sh export`.

## Procedure 3 — Verify your escrow (non-destructive)

Run anytime, especially after any deploy. Pure read-only — no writes, no Vault change:

```sql
-- (a) escrow matches the live Vault key:
select (decrypted_secret = '<ESCROW>') as matches
  from vault.decrypted_secrets where name = 'content_enc_key';           -- expect: true

-- (b) THE authoritative test — the escrow actually decrypts real ciphertext at rest:
select extensions.pgp_sym_decrypt(content, '<ESCROW>')::jsonb
  from public.chat_messages limit 1;   -- plaintext => correct key;  error => WRONG key, do not trust
-- if chat_messages is empty this returns 0 rows = INCONCLUSIVE, not pass; try messages.title instead:
select extensions.pgp_sym_decrypt(title, '<ESCROW>') from public.messages limit 1;
```

Run **(b) against prod specifically** — that's what distinguishes a real escrow from a same-named key
of a different environment. `helper: scripts/encryption-key.sh verify`.

## Procedure 4 — Recover from a lost/wrong key (verify-gated)

The Vault key is gone or wrong, **but the ciphertext rows still exist**.

```sql
-- STEP 1 (MANDATORY GATE): prove your escrow decrypts a REAL row — WITHOUT touching Vault:
select extensions.pgp_sym_decrypt(content, '<ESCROW>')::jsonb from public.chat_messages limit 1;
--   plaintext  => your escrow is correct, proceed.
--   error/0 rows => STOP. Do not delete anything. Find the right key first.

-- STEP 2: only after STEP 1 returns plaintext — install it.
--   create_secret FAILS if a (wrong) key still occupies the name, so remove that one FIRST, then create:
delete from vault.secrets where name = 'content_enc_key';   -- only reached after STEP 1 proved the escrow
select vault.create_secret('<ESCROW>','content_enc_key','restored from offline escrow');

-- STEP 3: confirm live reads work again.
select extensions.pgp_sym_decrypt(content, (select decrypted_secret
  from vault.decrypted_secrets where name='content_enc_key'))::jsonb from public.chat_messages limit 1;
```

`helper: scripts/encryption-key.sh restore` refuses STEP 2 unless STEP 1 passed.

## Procedure 5 — Full disaster recovery into a new project

Project deleted/rebuilt. Rows must be restored first, *then* the key:

1. **Restore the rows** — Supabase managed backup/PITR (full, all tables) **or** the external
   `backup.sql.gpg` (`gpg --decrypt` needs `BACKUP_GPG_PASSPHRASE`, then `psql` the `.sql`; note it
   carries `messages` + `daily_state` but **not** chats).
2. **Install the escrowed key** with Procedure 4 so the restored ciphertext decrypts.

---

## Residual notes

- **Never rotate the key in place.** Overwriting the Vault value orphans every row written under the
  old key. A rotation must be a decrypt-then-re-encrypt over all rows in one transaction, and you must
  keep a **dated, versioned** offline archive of *every* key epoch (a single "latest" copy can't
  decrypt pre-rotation rows). No rotation tooling exists yet — treat rotation as a project.
- **Escrow both secrets.** External-dump recovery needs `content_enc_key` *and* `BACKUP_GPG_PASSPHRASE`.
- **Studio SQL editor caution.** Pasting the raw key into the dashboard SQL editor persists it in
  snippet history and may hit statement logging. Prefer `psql` over a connection string you control,
  and clear snippet history after.
- **Not E2E.** The operator (service_role / Vault root key) can always decrypt. This runbook is about
  durability, not hiding content from yourself.
