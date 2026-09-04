#!/usr/bin/env bash
# Pins the local Supabase stack's published ports to loopback (TOD-119).
#
# WHY THIS EXISTS
#   `supabase start` publishes as `-p 54321:8000` with no host IP, so the bind
#   address comes from the DOCKER NETWORK, not the mapping. The default is
#   0.0.0.0 — every interface. On wifi that puts Studio (which has NO login in
#   local mode) and Postgres itself in front of anyone on the same network.
#
# WHY IT IS A SCRIPT AND NOT A CONFIG KEY
#   * supabase/config.toml exposes ports only — no host/bind key (CLI 2.107.0).
#   * dockerd's `ip` daemon key covers the DEFAULT bridge only. Supabase runs on
#     a user-defined bridge, whose knob is the driver option
#     `com.docker.network.bridge.host_binding_ipv4` — settable only at CREATE time.
#   So the network has to be created before the stack, which is what this does.
#
# WHY IT STICKS
#   * `supabase start` calls DockerNetworkCreateIfNotExists, which swallows the
#     "already exists" conflict — a network we pre-create by name is REUSED.
#   * `supabase stop` runs `network prune --filter
#     label=com.supabase.cli.project=<id>`. We create the network WITHOUT that
#     label, so the prune does not match it and the binding survives stop/start.
#
# Idempotent and safe to re-run: if the network is already correct it does nothing.
# Needs no sudo. Run it BEFORE `supabase start` — on a fresh clone, after a
# `docker system prune`, or any time the check below reports 0.0.0.0.
#
# Usage: scripts/supabase-loopback-network.sh [--check]
#   --check   report only; exit 1 if the binding is not loopback (for CI/pre-flight)

set -euo pipefail

OPT="com.docker.network.bridge.host_binding_ipv4"

# Parse project_id with awk + POSIX classes, NOT sed/grep with \s: BSD sed on macOS
# treats \s as a literal 's', which silently yields a one-space project id (and so a
# network named "supabase_network_ "). Fail closed rather than act on a bad name.
PROJECT="${SUPABASE_PROJECT_ID:-}"
if [ -z "$PROJECT" ]; then
  PROJECT="$(awk -F= '/^[[:space:]]*project_id[[:space:]]*=/{gsub(/["[:space:]]/,"",$2); print $2; exit}' \
    supabase/config.toml 2>/dev/null || true)"
fi
case "$PROJECT" in
  ""|*[!A-Za-z0-9_-]*)
    echo "error: could not read a usable project_id from supabase/config.toml" >&2
    echo "       run from the repo root, or set SUPABASE_PROJECT_ID." >&2
    exit 2
    ;;
esac
NET="supabase_network_${PROJECT}"

check_only=0
if [ "${1:-}" = "--check" ]; then check_only=1; fi

# Test existence separately: `network inspect` on a missing network still writes a
# blank line to stdout, so folding the two cases into one substitution yields a
# leading newline and the missing-network branch never matches.
if docker network inspect "$NET" >/dev/null 2>&1; then
  current="$(docker network inspect "$NET" -f "{{index .Options \"$OPT\"}}" 2>/dev/null)"
else
  current="__MISSING__"
fi

if [ "$current" = "127.0.0.1" ]; then
  echo "ok: $NET publishes to 127.0.0.1 only"
  exit 0
fi

if [ "$check_only" = "1" ]; then
  if [ "$current" = "__MISSING__" ]; then
    echo "warn: $NET does not exist yet — run this script before \`supabase start\`" >&2
  else
    echo "FAIL: $NET publishes to ${current:-0.0.0.0} — the stack is reachable from the LAN" >&2
    echo "      stop the stack and re-run: scripts/supabase-loopback-network.sh" >&2
  fi
  exit 1
fi

if docker ps -q --filter "label=com.supabase.cli.project=${PROJECT}" | grep -q .; then
  echo "The stack is running on a network that publishes to ${current:-0.0.0.0}." >&2
  echo "Containers keep the binding they were created with, so they must be recreated:" >&2
  echo "  supabase stop && scripts/supabase-loopback-network.sh && supabase start" >&2
  echo "(\`supabase stop\` keeps your data — it only deletes volumes with --no-backup.)" >&2
  exit 1
fi

docker network rm "$NET" >/dev/null 2>&1 || true
docker network create -o "$OPT=127.0.0.1" "$NET" >/dev/null
echo "created $NET publishing to 127.0.0.1 only — now run \`supabase start\`"
