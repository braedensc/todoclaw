# onboarding

Two cooperating first-run systems: the **"Get set up" guide** (a dismissible checklist card at the
top of the home shell) and the **feature tour** it launches (a spotlight walkthrough that now opens
on a live example day).

## The guide (SetupGuide + use-setup-guide)

Platform-adaptive steps, each auto-detecting completion:

1. **See how Todoclaw works** — launches the two-act tour (below).
2. **Install as a web app** — platform-specific gesture (iOS: Share → Add to Home Screen, which is
   *required* for push there; macOS Safari: File → Add to Dock; Chromium: a native install button
   via `beforeinstallprompt`, or address-bar instructions). Hidden where no gesture exists
   (e.g. Firefox desktop). Ordered before notifications on Apple (a tab can't grant them there).
3. **Turn on daily notifications** — opens Settings scrolled to the Daily-notifications section.
4. **Try Plan My Day** — fires the same generate as the header pill.

## The tour (FeatureTour + tour-steps + DemoScene)

`FeatureTour` is a generic spotlight engine: each step names a `data-tour` anchor in the mounted
shell; anchors resolve ONCE at mount and missing ones drop out silently. The full tour runs in
**two acts** (sequenced by App.tsx):

- **Act 1 — the example day.** `DemoScene` is a full-screen overlay showing the app in real use:
  the REAL board components (GridSurface / MobileMatrix) fed by a nested, sealed TanStack
  QueryClient (`enabled: false` + every key pre-seeded → zero backend traffic, and new card
  treatments show up in the demo for free), the real PlanBox with a canned plan, and the real
  ChatConversation playing the scripted morning push + evening check-in. The check-in texts are
  drift-guarded by a Deno test (`supabase/functions/_shared/demo-transcript.test.ts`) that re-runs
  the actual dispatch builders over the fixtures in `demo-transcript.ts`. The scene is inert +
  aria-hidden scenery; `DEMO_TOUR` narrates it via `demo-*` anchors only.
- **Act 2 — your own shell.** The trimmed per-breakpoint scripts (`DESKTOP_TOUR` / `MOBILE_TOUR`)
  point at the real, empty shell: "you just saw this — here's where it lives."

Skip semantics are act-aware: leaving Act 1 (the skip button reads "Skip to your board") ADVANCES
to Act 2 — people skip spectacle, not orientation. Only closing Act 2 latches the tour done
(localStorage + the `config.onboarding.tourSeen` account mirror). The empty-board states offer a
standalone "See an example board" peek (`demo-solo` — closes back to home, latches nothing), and
Settings has "Replay the tour" (both acts, without resetting the guide's checkmarks).

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
