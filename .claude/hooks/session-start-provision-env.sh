#!/usr/bin/env bash
# SessionStart hook: auto-provisions THIS worktree's .env.local + a dedicated
# local login the first time a session starts here, via scripts/dev-worktree-login.sh.
# Removes the need for a human to run that script manually every time a new
# worktree spins up (2026-07-04 — a new worktree hit the "no .env.local yet"
# dialog and had to be unblocked by hand).
#
# No-ops silently (no error, no output) when:
#   - .env.local already exists (already provisioned, or not a fresh worktree)
#   - this isn't a todoclaw worktree (no supabase/config.toml, or no login script)
#   - the local Supabase stack isn't running yet — legitimate; don't block
#     session startup on it, and don't nag every session until it is.
#
# This is a plain, reviewed shell script the harness runs on a lifecycle event —
# not a Claude tool call — so it isn't subject to the separate PreToolUse guard
# that blocks Claude from writing .env files or JWT-shaped values (that guard
# exists to keep the *model* from ever handling raw secrets in its own
# reasoning; this script's secret values never pass through Claude's context
# either way, same as when a human runs dev-worktree-login.sh directly).
#
# The login script's stdout (which echoes the anon key + a dev password) is
# discarded to /dev/null — never written to a log file or surfaced to the model.
# The one line we emit back is a plain systemMessage naming the login email only.
set -u

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

[ -f .env.local ] && exit 0
[ -f supabase/config.toml ] || exit 0
[ -x ./scripts/dev-worktree-login.sh ] || exit 0
command -v supabase >/dev/null 2>&1 || exit 0
supabase status >/dev/null 2>&1 || exit 0

slug="$(basename "$(pwd)")"

if ./scripts/dev-worktree-login.sh "$slug" >/dev/null 2>&1; then
  printf '{"systemMessage": "Auto-provisioned .env.local + local login (%s@todoclaw.local) for this worktree."}\n' "$slug"
fi
exit 0
