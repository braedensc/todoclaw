#!/usr/bin/env bash
# ios-sim-shot.sh — capture the signed-in app in a REAL iOS Safari simulator.
#
# The Playwright device lab (npm run device-lab) is Chromium emulation: right geometry, wrong
# engine. This is the real-engine lane — it boots an iOS simulator headlessly (no window), signs
# the e2e test user in via a one-time LOCAL admin magic link (no credentials typed anywhere),
# loads the app in actual Safari/WebKit, and saves a device-pixel screenshot you can eyeball.
#
#   Usage:    scripts/ios-sim-shot.sh <device-type> <slug> [settle-seconds]
#   Example:  scripts/ios-sim-shot.sh iPhone-16-Pro iphone-16-pro 12
#             (device types: `xcrun simctl list devicetypes` — the id suffix after the last dot)
#   Output:   device-lab-report/ios-sim/<slug>.png   (gitignored artifact dir)
#
# Prereqs:
#   - Full Xcode + an iOS simulator runtime (`xcodebuild -downloadPlatform iOS` once, ~8 GB).
#     If xcode-select points at the Command Line Tools, this script routes around it via
#     DEVELOPER_DIR — no sudo, no global switch.
#   - `supabase start` (the magic link is minted by the LOCAL admin API; never remote).
#   - The dev server on http://127.0.0.1:3000 — the ONLY origin the local auth config allows a
#     magic-link redirect to (supabase/config.toml site_url):
#       npm run dev -- --port 3000 --strictPort --host 127.0.0.1
#
# Battle-tested quirks this script absorbs (found driving iPhone 16→17 for #301's follow-up):
#   - gotrue's JSON escapes '&' as & inside action_link → unescape or /verify 400s.
#   - Safari's first-launch coachmark lingers for the whole session → warm-load once, terminate
#     Safari, relaunch clean for the shot (also outlasts the "Apple Intelligence" boot banner).
#   - `openurl` right after bootstatus times out (code=60) on back-to-back boots → settle+retry,
#     and wait for full Shutdown before returning so serial runs don't starve each other.
set -euo pipefail

if [ ! -d "${DEVELOPER_DIR:-}" ]; then
  export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
fi
[ -d "$DEVELOPER_DIR" ] || { echo "Xcode not found at $DEVELOPER_DIR — install Xcode first"; exit 1; }

DTYPE="com.apple.CoreSimulator.SimDeviceType.${1:?usage: ios-sim-shot.sh <device-type> <slug> [settle-seconds]}"
SLUG="${2:?usage: ios-sim-shot.sh <device-type> <slug> [settle-seconds]}"
SETTLE="${3:-12}"
APP_URL="${APP_URL:-http://127.0.0.1:3000}"
SIM_EMAIL="${SIM_EMAIL:-e2e@todoclaw.test}"
NAME="todoclaw-lab-$SLUG"
OUT="$(cd "$(dirname "$0")/.." && pwd)/device-lab-report/ios-sim"
mkdir -p "$OUT"

# Newest installed iOS runtime (the create call needs one explicitly).
RUNTIME=$(xcrun simctl list runtimes | awk '/^iOS/ {id=$NF} END {print id}')
[ -n "$RUNTIME" ] || { echo "no iOS simulator runtime — run: xcodebuild -downloadPlatform iOS"; exit 1; }

curl -sf -o /dev/null "$APP_URL" \
  || { echo "dev server not reachable at $APP_URL — npm run dev -- --port 3000 --strictPort --host 127.0.0.1"; exit 1; }

# Service-role key for the LOCAL stack only — held in a shell var, never printed (hard rule #2).
SR=$(supabase status -o json 2>/dev/null | sed -n 's/.*"SERVICE_ROLE_KEY": *"\([^"]*\)".*/\1/p')
[ -n "$SR" ] || { echo "no service key — is 'supabase start' running?"; exit 1; }

# Reuse the named device across runs; create it against the newest runtime otherwise.
UDID=$(xcrun simctl list devices | sed -n "s/^ *$NAME (\([0-9A-F-]*\)).*/\1/p" | head -1)
if [ -z "$UDID" ]; then
  UDID=$(xcrun simctl create "$NAME" "$DTYPE" "$RUNTIME")
  echo "created $NAME"
fi

# Never leave the sim running — a failed run would otherwise strand a booted device eating RAM
# and starving the next boot's services.
trap 'xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true' EXIT

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" >/dev/null
sleep 8 # bootstatus returns at "boot complete"; the URL-open service lags a beat behind
echo "booted $NAME"

openurl_retry() {
  for _ in 1 2 3; do
    if xcrun simctl openurl "$UDID" "$1" 2>/dev/null; then return 0; fi
    echo "openurl busy, retrying"
    sleep 10
  done
  xcrun simctl openurl "$UDID" "$1" # final try, surfacing the real error
}

# Warm-load: consumes Safari's first-launch coachmark and warms Vite's transform cache. Then
# terminate Safari so the real load relaunches without the coachmark.
openurl_retry "$APP_URL"
sleep 8
xcrun simctl terminate "$UDID" com.apple.mobilesafari 2>/dev/null || true
sleep 2

# One-time magic link, fresh per device (each sim has its own Safari storage).
LINK=$(curl -s -X POST "http://127.0.0.1:54321/auth/v1/admin/generate_link" \
  -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" \
  -d "{\"type\":\"magiclink\",\"email\":\"$SIM_EMAIL\",\"redirect_to\":\"$APP_URL\"}" \
  | sed -n 's/.*"action_link":"\([^"]*\)".*/\1/p')
LINK="${LINK//\\u0026/&}"
[ -n "$LINK" ] || { echo "magic-link generation failed — does $SIM_EMAIL exist? (golden auth setup creates it)"; exit 1; }

openurl_retry "$LINK"
echo "opened app, settling ${SETTLE}s"
sleep "$SETTLE"
xcrun simctl io "$UDID" screenshot "$OUT/$SLUG.png" >/dev/null
xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true

# Wait out the teardown so back-to-back invocations never overlap boot/shutdown.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  state=$(xcrun simctl list devices | sed -n "s/^ *$NAME ([0-9A-F-]*) (\([A-Za-z]*\)).*/\1/p" | head -1)
  [ "$state" = "Shutdown" ] && break
  sleep 2
done
echo "shot $OUT/$SLUG.png"
