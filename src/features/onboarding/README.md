# onboarding

Two cooperating first-run systems: the **"Get set up" guide** (a dismissible checklist card at the
top of the home shell) and the **feature tour** it launches (a spotlight walkthrough that now opens
on a live example day).

## The guide (SetupGuide + use-setup-guide)

Platform-adaptive steps, each auto-detecting completion:

1. **See how TodoClaw works** — launches the feature tour (below).
2. **Install as a web app** — platform-specific gesture (iOS: Share → Add to Home Screen, which is
   *required* for push there; macOS Safari: File → Add to Dock; Chromium: a native install button
   via `beforeinstallprompt`, or address-bar instructions). Hidden where no gesture exists
   (e.g. Firefox desktop). Ordered before notifications on Apple (a tab can't grant them there).
3. **Turn on daily notifications** — opens Settings scrolled to the Daily-notifications section.
4. **Try Plan My Day** — fires the same generate as the header pill.

## The tour (FeatureTour + tour-steps + DemoScene)

`FeatureTour` is a generic spotlight engine: each step names a `data-tour` anchor in the mounted
shell; anchors resolve ONCE at mount and missing ones drop out silently. It also measures the real
card height post-render, so a step whose copy runs long can't park its Next button below the fold
(the card is `position: fixed` and never scrolls).

The tour is **one section — eight panels, all on the example day**. `DemoScene` is a full-screen
overlay showing the app in real use: the REAL board components (GridSurface / MobileMatrix) fed by a
nested, sealed TanStack QueryClient (`enabled: false` + every key pre-seeded → zero backend traffic,
and new card treatments show up in the demo for free), the real PlanBox with a canned plan, and the
real ChatConversation playing the scripted morning push + evening check-in. The check-in texts are
drift-guarded by a Deno test (`supabase/functions/_shared/demo-transcript.test.ts`) that re-runs the
actual dispatch builders over the fixtures in `demo-transcript.ts`. The scene is inert + aria-hidden
scenery; `demoTour(isMobile)` narrates it via `demo-*` anchors only. The eight panels: welcome →
board → three task kinds → **Plan My Day (the ✦ button + the plan it builds)** → morning → evening →
daily habits → settings. The BOARD step's copy differs per breakpoint — the desktop grid shows the
heat/cool/↻/❄️ decoder ring, the mobile quadrant overview shows none.

Crucially, the last three "chrome" targets — the Plan My Day button, an example **Daily-habits**
card, and an example **Settings** card — are look-only scenery rendered ON the DemoScene, NOT the
real shell's buttons. That's deliberate: pointing at the real shell would mean tearing down the
example mid-tour (a visible surface jump), so instead everything the tour spotlights lives on the
one scene. There is no second leg.

Finishing OR skipping the tour latches it done (localStorage + the `config.onboarding.tourSeen`
account mirror) — someone who skips shouldn't be nagged by an eternal unchecked box. The empty-board
states offer the same walkthrough as a standalone "See an example board" peek (`demo-solo` — its
escape hatch reads "Close", and it closes back to home latching nothing), and Settings has "Replay
the tour" (without resetting the guide's checkmarks).

The demo fixtures live in `demo-board.ts` (tasks authored relative to *today* so the board always
renders mid-story — its header lists every visual state it intentionally exercises; extend it when
a new card treatment ships) and `demo-transcript.ts` (the plan + check-ins, dependency-free so the
Deno drift test can import it).

## Design notes

- **Checklist, not wizard.** The install gesture happens *outside* the page and reopens the app in
  a fresh context (on iOS, with separate storage — the user even signs in again), so any modal
  step-by-step flow would be lost mid-stream. A persistent card with live detection survives it.
- **Every step auto-detects** (`use-setup-guide.ts`): tour latch/mirror, standalone display-mode,
  `config.notifications.enabled` + `Notification.permission` (the same two halves the dispatcher
  requires), and today's plan (latched in localStorage so the midnight plan-clear doesn't regress
  the checkmark).
- **Per-device semantics.** Dismissal lives in localStorage (`setup-guide-store.ts`), not account
  config — reappearing on a new device is correct, since install/permission are per-device. A user
  already fully set up never sees the card (silent auto-dismiss on load). The tour checkmark alone
  is device-independent (the account mirror), because watching the tour twice helps nobody.
- **Re-findable:** Settings → "Show the setup guide" (calls `resetSetupGuide()`), or "Replay the
  tour" for just the walkthrough.
- **Golden suite:** `e2e/golden/auth.setup.ts` seeds the dismissal key before sign-in so specs
  assert the established shell, not the guide (the demo scene never mounts there either — the tour
  only launches from the guide, the empty states, or Settings).
