# Device lab — phone-matrix layout verification

Answers "what does the mobile layout actually look like across phones?" without owning the
phones: one spec runs the real, signed-in app (local Supabase + the checked-in demo seed) across
a matrix of phone geometries, asserts the shell's anchoring contract in every state, and
assembles the screenshots into a single contact sheet.

```bash
supabase start        # the lab drives the real app, like the golden suite
npm run device-lab    # → open device-lab-report/index.html
```

## What every cell proves

The invariant (the "bottom bar pulled up" class of bug): **the bottom nav sits flush to the
layout-viewport bottom and the page itself is never scrolled** — asserted per device in each state:

| Column | State | What it catches |
| --- | --- | --- |
| baseline | resting home | bar not flush / page scrolled / meta canary (`resizes-visual` + `viewport-fit=cover`) |
| browser chrome | descriptor's in-browser viewport | bar mis-tracking with the URL bar visible |
| standalone | full-screen height (PWA / retracted toolbar) | the 100svh-style "dead strip under the bar" class of bug |
| add sheet + keyboard | OSK simulated over the ➕ sheet | keyboard compressing the shell / moving the bar (the old `resizes-content` Android bug) |
| chat + keyboard | OSK simulated over the chat composer | the `useKeyboardViewport` re-fit — composer must land above the keys, bar unmoved beneath |

The device list lives in `playwright.device-lab.config.ts` (`PHONES`) — add a descriptor name
there to grow the matrix.

## Fidelity boundary — read before trusting it blindly

This is Chromium **device emulation**: exact viewport, DPR, UA and touch per device — but not the
Safari/OEM engine, and there is no real on-screen keyboard. Concretely:

- **Keyboard scenarios** drive the app's real `visualViewport` listeners through a shim
  (`__deviceLab.simulateKeyboard`), which is the same code path a real overlay keyboard takes —
  but it can't reproduce browser-initiated quirks (iOS focus auto-scroll, toolbar collapse
  timing). The `useLockedViewportGuard` residue snap-back is unit-tested instead
  (`src/hooks/use-locked-viewport-guard.test.ts`).
- **`env(safe-area-inset-*)` resolves to 0** under emulation, so home-indicator padding renders
  collapsed; on notched hardware the bar is a little taller. The flush-to-bottom assertion is
  unaffected.
- Engine-specific rendering (fonts, form controls) is Chromium's.

The lab catches layout/geometry regressions across the size spread before any phone sees them; a
real device (or Safari's responsive mode) stays the final word on engine quirks.

## Real-engine lane: `scripts/ios-sim-shot.sh`

When the question is Safari itself — WebKit rendering, the real URL bar, safe areas — the
companion script boots an actual iOS simulator headlessly, signs the e2e user in via a one-time
local magic link (no credentials typed), and saves a device-pixel screenshot:

```bash
# prereqs: full Xcode + iOS runtime (once: xcodebuild -downloadPlatform iOS), supabase start,
# and the dev server on the auth-allow-listed origin:
npm run dev -- --port 3000 --strictPort --host 127.0.0.1

scripts/ios-sim-shot.sh iPhone-16-Pro iphone-16-pro   # → device-lab-report/ios-sim/<slug>.png
```

Any device type from `xcrun simctl list devicetypes` works (iPhone 16 family, 17 family, Air…).
The script header documents the simulator quirks it absorbs (coachmark, openurl timing,
gotrue's escaped links).
