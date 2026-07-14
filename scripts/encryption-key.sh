#!/usr/bin/env bash
# Content-encryption key: backup & recovery helper (see docs/RUNBOOK-KEY-RECOVERY.md + ADR
# 2026-07-14-encrypt-content-at-rest). Encodes the ONE safety rule the runbook is built around:
#
#   Never delete/overwrite the Vault key until pgp_sym_decrypt with your escrowed string has
#   returned plaintext from a REAL row.  ("restore" refuses STEP 2 unless STEP 1 proved the escrow.)
#
# The key never appears in argv or shell history: it is read from / written to a file (chmod 600),
# and passed to psql only via a temporary 0600 SQL file that is removed immediately. Prefer this over
# hand-run SQL, and prefer a psql connection you control over the Studio SQL editor (snippet history).
#
# Connection: set DB_URL to the target database (prod pooler string for real recovery; the local
# stack for a dry run). Nothing is hardcoded.
#
# Usage:
#   DB_URL=... scripts/encryption-key.sh generate <out-keyfile>   # make a fresh key (Procedure 1)
#   DB_URL=... scripts/encryption-key.sh export   <out-keyfile>   # copy the live key out (Procedure 2)
#   DB_URL=... scripts/encryption-key.sh verify   <keyfile>       # non-destructive check (Procedure 3)
#   DB_URL=... scripts/encryption-key.sh restore  <keyfile>       # verify-gated re-seed (Procedure 4)
#
# Store the keyfile's contents in your PASSWORD MANAGER, labelled with the project-ref + date, then
# delete the file. This helper is a convenience around the runbook, not a substitute for reading it.

set -euo pipefail

SECRET_NAME='content_enc_key'
cmd="${1:-}"
keyfile="${2:-}"

die() { echo "error: $*" >&2; exit 1; }
need_db() { : "${DB_URL:?set DB_URL to the target database connection string}"; }

# Read a key from a file, stripping a trailing newline (openssl rand -base64 appends one, and pgcrypto
# is byte-exact — this defuses the #1 escrow footgun). Validate it is base64 so it is safe to inline
# into a single-quoted SQL literal (no injection surface).
read_key() {
  [ -n "$keyfile" ] || die "usage: $0 $cmd <keyfile>"
  [ -f "$keyfile" ] || die "keyfile not found: $keyfile"
  KEY="$(< "$keyfile")"                 # $(<file) strips trailing newlines
  KEY="${KEY%%$'\n'*}"                  # and any stray extra lines
  [[ "$KEY" =~ ^[A-Za-z0-9+/]+=*$ ]] || die "keyfile does not contain a base64 key"
}

# Run SQL from a transient 0600 file (keeps the key out of argv/ps and shell history), always removed.
run_sql() {
  local f; f="$(mktemp)"; chmod 600 "$f"
  # shellcheck disable=SC2064
  trap "rm -f '$f'" RETURN
  cat > "$f"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=0 -f "$f"
}

# Emit a DO block that tries to decrypt the first available real ciphertext with $KEY and prints
# RESULT=PASS / FAIL / INCONCLUSIVE. Vault is never touched. \$\$ escapes so bash writes a literal $$.
decrypt_probe_sql() {
  cat <<EOF
do \$\$
declare c bytea; v text;
begin
  select coalesce(
    (select content from public.chat_messages limit 1),
    (select title   from public.messages       limit 1),
    (select title   from public.chat_sessions where title is not null limit 1),
    (select plan    from public.daily_state     where plan  is not null limit 1)
  ) into c;
  if c is null then raise notice 'RESULT=INCONCLUSIVE (no encrypted rows to test against)'; return; end if;
  begin
    v := extensions.pgp_sym_decrypt(c, '${KEY}');
    raise notice 'RESULT=PASS (escrow decrypts real ciphertext at rest)';
  exception when others then
    raise notice 'RESULT=FAIL (escrow does NOT decrypt: %)', sqlerrm;
  end;
end \$\$;
EOF
}

case "$cmd" in
  generate)
    [ -n "$keyfile" ] || die "usage: $0 generate <out-keyfile>"
    [ -e "$keyfile" ] && die "refusing to overwrite existing $keyfile"
    ( umask 077; openssl rand -base64 32 | tr -d '\n' > "$keyfile" )
    echo "Wrote a new 32-byte base64 key to $keyfile (mode 600)."
    echo "NEXT: store its contents in your password manager (label: <project-ref> $(date +%F)),"
    echo "      install it in PROD Vault BEFORE deploying (Procedure 1), then delete the file."
    ;;

  export)
    need_db
    [ -n "$keyfile" ] || die "usage: $0 export <out-keyfile>"
    [ -e "$keyfile" ] && die "refusing to overwrite existing $keyfile"
    v="$(psql "$DB_URL" -X -Atqc \
      "select decrypted_secret from vault.decrypted_secrets where name='${SECRET_NAME}';")"
    [ -n "$v" ] || die "no '${SECRET_NAME}' secret found on this database"
    ( umask 077; printf '%s' "$v" > "$keyfile" )
    echo "Exported the live key to $keyfile (mode 600)."
    echo "NEXT: store its contents in your password manager, then delete the file. Verify with:"
    echo "      DB_URL=... $0 verify $keyfile"
    ;;

  verify)
    need_db; read_key
    echo "== (a) does the escrow match the live Vault key? =="
    psql "$DB_URL" -X -q -v ON_ERROR_STOP=0 <<SQL || true
select coalesce((select (decrypted_secret = '${KEY}')
  from vault.decrypted_secrets where name='${SECRET_NAME}')::text,
  'no live key present') as matches;
SQL
    echo "== (b) does the escrow decrypt real ciphertext at rest? (authoritative) =="
    decrypt_probe_sql | run_sql
    ;;

  restore)
    need_db; read_key
    echo "GATE: proving the escrow decrypts a real row BEFORE any Vault change..."
    probe="$(decrypt_probe_sql | run_sql 2>&1)"; echo "$probe"
    if echo "$probe" | grep -q 'RESULT=PASS'; then
      echo "Gate PASSED — the escrow is correct. Re-seeding the Vault key..."
    elif echo "$probe" | grep -q 'RESULT=INCONCLUSIVE'; then
      echo "No encrypted rows exist yet — nothing to mismatch; proceeding is safe."
    else
      die "Gate FAILED — the escrow did NOT decrypt existing data. Refusing to touch Vault. Find the correct key first."
    fi
    run_sql <<SQL
delete from vault.secrets where name='${SECRET_NAME}';
select vault.create_secret('${KEY}', '${SECRET_NAME}', 'restored from offline escrow') is not null as restored;
SQL
    echo "Done. Confirm live reads:  DB_URL=... $0 verify $keyfile   (expect matches=true, RESULT=PASS)"
    ;;

  *)
    grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
