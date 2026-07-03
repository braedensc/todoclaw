#!/usr/bin/env bash
# Provisions THIS worktree for local dev against the local Supabase stack:
#   1. writes .env.local (gitignored, per-folder — see docs/COLLABORATION.md)
#   2. creates a dedicated <slug>@todoclaw.local login for this worktree/session
#
# All worktrees share one local Supabase stack (one `project_id`, one Docker stack,
# one Postgres DB — supabase/config.toml), so without step 2 parallel sessions end up
# fighting over one shared account. Run by a human, not Claude — the Claude Code
# PreToolUse hook blocks writes to .env files and any JWT-shaped value (docs/SETUP.md).
#
# Usage: scripts/dev-worktree-login.sh <slug>
#   <slug> — a short name for this worktree/session (e.g. its branch or folder name).

set -euo pipefail

slug="${1:?Usage: scripts/dev-worktree-login.sh <slug>}"
email="${slug}@todoclaw.local"
password="devpassword123"

if [ ! -f supabase/config.toml ]; then
  echo "Run this from a todoclaw worktree root (no supabase/config.toml here)." >&2
  exit 1
fi

if ! command -v supabase >/dev/null; then
  echo "supabase CLI not found — brew install supabase/tap/supabase" >&2
  exit 1
fi

if ! supabase status >/dev/null 2>&1; then
  echo "Local Supabase stack isn't running — run 'supabase start' first." >&2
  exit 1
fi

env_out="$(supabase status -o env \
  --override-name api.url=VITE_SUPABASE_URL \
  --override-name auth.anon_key=VITE_SUPABASE_ANON_KEY)"

grep '^VITE_' <<<"$env_out" > .env.local
echo "VITE_SENTRY_DSN=" >> .env.local

api_url="$(grep '^VITE_SUPABASE_URL=' <<<"$env_out" | cut -d= -f2- | tr -d '"')"
service_role_key="$(grep '^SERVICE_ROLE_KEY=' <<<"$env_out" | cut -d= -f2- | tr -d '"')"

tmp_response="$(mktemp)"
trap 'rm -f "$tmp_response"' EXIT

status_code="$(curl -s -o "$tmp_response" -w '%{http_code}' \
  -X POST "${api_url}/auth/v1/admin/users" \
  -H "apikey: ${service_role_key}" \
  -H "Authorization: Bearer ${service_role_key}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${email}\",\"password\":\"${password}\",\"email_confirm\":true}")"

if [ "$status_code" = "200" ] || [ "$status_code" = "201" ]; then
  echo "Created local user: ${email}"
elif grep -qi "already been registered\|already exists" "$tmp_response"; then
  echo "${email} already exists — reusing it."
else
  echo "Unexpected response (HTTP ${status_code}):" >&2
  cat "$tmp_response" >&2
  exit 1
fi

echo
echo ".env.local written — pointing at the local Supabase stack (http://127.0.0.1:54321)."
echo "Sign in with:"
echo "  email:    ${email}"
echo "  password: ${password}"
