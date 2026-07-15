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

The tour is **one section — nine panels**. `DemoScene` mounts INLINE in the real shell — below the
real header/masthead, in the exact spot App.tsx would otherwise render the real PlanBox /
RemindersInline / WorkArea (which App.tsx hides while the tour is up, so nothing stacks two boards).
It is not a portal or a fixed overlay, so the real chrome around it — the header, the mascot mark,
the Account nav, the mobile bottom bar — is always visible and never covered. Inside DemoScene: the
REAL board components (GridSurface / MobileMatrix) fed by a nested, sealed TanStack QueryClient
(`enabled: false` + every key pre-seeded → zero backend traffic, and new card treatments show up in
the demo for free), the real RemindersInline habits strip above the board, and the real
ChatConversation playing the scripted morning push + evening check-in. The check-in texts are
drift-guarded by a Deno test (`supabase/functions/_shared/demo-transcript.test.ts`) that re-runs the
actual dispatch builders over the fixtures in `demo-transcript.ts`. The scene is inert + aria-hidden
scenery; `demoTour(isMobile)` narrates its first eight steps via `demo-*` anchors. The nine panels:
welcome → board → three task kinds → **Plan My Day (the ✦ button + the plan it builds)** → morning →
evening → chat-runs-the-whole-app → daily habits → the rest of the app. Two steps' copy differs per
breakpoint: the BOARD step (the desktop grid has the heat/cool/↻/❄️ decoder ring, the mobile
quadrant overview has none) and the
closing options step (below).

The ONE thing that stays look-only is the plan panel (`demo-plan`: a fake ✦ Plan My Day button +
the real PlanBox with a canned plan) — a first-run user has no real plan yet, so the tour fakes what
one looks like rather than pointing at the real header button's honest empty state. The real header's
own Plan My Day button (or the mobile pill) is untouched and stays visible, showing the user's actual
plan state, for the whole tour. Everything else the tour spotlights is real: the closing step targets
`options`, a `data-tour="options"` attribute on the REAL Account nav (desktop header,
`App.tsx`) / the REAL `MobileBottomNav` (mobile, ADR-0028 — a phone has no header nav; Chat/Done are
tabs and habits/Settings sit under "⋯ More") — no look-alike copy of either.

⚠️ The first seven anchors are `demo-`-prefixed for a reason worth keeping: `grid`/`matrix`-style
generic names also exist in the real shell, and `FeatureTour` resolves anchors with `querySelector`
(first match in document order) — an unprefixed name wouldn't fail loudly, it would silently
spotlight the wrong element. `demo-content.test.ts` pins that every step but the last matches
`/^demo-/`, and that the last one is exactly `options`. Specs asserting DemoScene's own look-only
content should still scope to its `[data-tour="demo-*"]` anchor rather than a bare `getByText` where
the copy could plausibly collide with something else on the page.

Finishing OR skipping the tour latches it done (localStorage + the `config.onboarding.tourSeen`
account mirror) — someone who skips shouldn't be nagged by an eternal unchecked box. The empty-board
states offer the same walkthrough as a standalone "See an example board" peek (`demo-solo` — its
escape hatch reads "Close", and it closes back to home latching nothing), and Settings has "Replay
the tour" (without resetting the guide's checkmarks).

The demo fixtures live in `demo-board.ts` (the app-typed ones: tasks authored relative to *today* so
the board always renders mid-story — its header lists every visual state it intentionally exercises,
extend it when a new card treatment ships — plus the habits, derived from the transcript so the strip
and the morning push can't disagree) and `demo-transcript.ts` (the plan + check-ins, dependency-free
so the Deno drift test can import it).

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
