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

The tour is **one section — nine panels (ten on mobile)**. `DemoScene` mounts INLINE in the real shell — below the
real header/masthead, in the exact spot App.tsx would otherwise render the real PlanBox /
RemindersInline / WorkArea (which App.tsx hides while the tour is up, so nothing stacks two boards).
It is not a portal or a fixed overlay, so the real chrome around it — the header, the mascot mark,
the Account nav, the mobile bottom bar — is always visible and never covered. Inside DemoScene: the
REAL grid (GridSurface on desktop; TouchGridSurface in its `embedded` panel form on mobile — the
same grid a phone reaches through Grid view), the real MobileMatrix quadrant overview on mobile, the
real add surface per breakpoint (mobile: AddTaskForm, the ➕ sheet's form, with its schedule
disclosure pre-opened; desktop: the SchedulePanel exactly as the Task Manager's 📅 chip opens it —
so the Task / Recurring / Ongoing switch is shown on the actual control), the real RemindersInline
habits strip, and the real
ChatConversation playing a scripted free-form ask plus the morning push + evening check-in — all fed
by a nested, sealed TanStack QueryClient (`enabled: false` + every key pre-seeded → zero backend
traffic, and new card treatments show up in the demo for free). The check-in texts are
drift-guarded by a Deno test (`supabase/functions/_shared/demo-transcript.test.ts`) that re-runs the
actual dispatch builders over the fixtures in `demo-transcript.ts`. The scene is inert + aria-hidden
scenery; `demoTour(isMobile)` narrates it.

The panels: welcome (on the REAL masthead, `app-top` — the tour opens at the top of the app, not
mid-board) → the grid → *[mobile only]* the quadrant overview → three kinds of task (the add UI) →
chat runs the whole app → **Plan My Day (the ✦ button + the plan it builds)** → morning → evening →
daily habits → Done and Settings (on the REAL nav). Nine on desktop, ten on mobile.

⚠️ **Step order must match DemoScene's section order.** FeatureTour scrolls each anchor into view as
it goes, so a script that walks the panels in a different order than the DOM scrolls the page
backwards mid-tour. `demo-content.test.ts` pins the exact sequence; DemoScene's sections are
numbered in comments to match.

What differs per breakpoint: the grid step (desktop teaches the card decoder ring — heat/cool/↻/❄️ —
which touch chips don't have; mobile names the ▦ Grid button instead), the mobile-only overview
step, the closing options step (below), and the bottom-bar call-outs. A step's optional `also`
names a SECOND anchor to ring alongside the spotlight: on a phone the add and chat panels ring their
tab in `MobileBottomNav` (`nav-add`, `nav-chat`), so the surface and the button that opens it are
learned together. (Not the closing panel — it already spotlights the whole bar.) It gets a ring plus a brightened backdrop rather than a second
cutout — one hole stays the focal point — and a missing anchor is simply ignored, which is what
lets desktop share the same steps.

The ONE thing that stays look-only is the plan panel (`demo-plan`: a fake ✦ Plan My Day button +
the real PlanBox with a canned plan) — a first-run user has no real plan yet, so the tour fakes what
one looks like rather than pointing at the real header button's honest empty state. The real header's
own Plan My Day button (or the mobile pill) is untouched and stays visible, showing the user's actual
plan state, for the whole tour. Everything else the tour spotlights is real: the closing step targets
`options`, a `data-tour="options"` attribute on the REAL Account nav (desktop header,
`App.tsx`) / the REAL `MobileBottomNav` (mobile, ADR-0028 — a phone has no header nav; Chat/Done are
tabs and habits/Settings sit under "⋯ More") — no look-alike copy of either.

⚠️ The scene's own anchors are `demo-`-prefixed for a reason worth keeping: `grid`/`matrix`-style
generic names also exist in the real shell, and `FeatureTour` resolves anchors with `querySelector`
(first match in document order) — an unprefixed name wouldn't fail loudly, it would silently
spotlight the wrong element. `demo-content.test.ts` pins that the first step is `app-top`, the last
is `options`, and every step between them matches `/^demo-/`. Specs asserting DemoScene's own look-only
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
- **Dismissal is per-ACCOUNT, detection is per-device.** The individual step checks stay device-local
  (install and permission genuinely are), but "I'm done with this card" is a fact about the person:
  it latches in localStorage *and* mirrors to `config.onboarding.setupDismissed`
  (`use-onboarding-mirror.ts`), so installing the app — a fresh storage partition — or clearing site
  data can't hand a finished user the checklist again. Same for the tour checkmark
  (`config.onboarding.tourSeen`): watching the tour twice helps nobody. A user already fully set up
  never sees the card at all (silent auto-dismiss on load, which writes the account flag too).
- **Anything that writes `user_schedule.config` must read-modify-write.** The save replaces the whole
  jsonb, so a writer that rebuilds the config from its own form deletes every section it doesn't
  model. That is exactly how a Settings save used to wipe `config.onboarding` and put "See how
  TodoClaw works" back on the checklist for someone who had already taken the tour — see
  `settings-form.ts`'s `carryOver()`, which passes non-editor keys through by default.
- **Re-findable:** Settings → "Show the setup guide" (calls `resetSetupGuide()` plus the account
  clears), or "Replay the tour" for just the walkthrough. Re-showing it is a one-shot: the card
  stays up until dismissed, and that dismissal settles it for good again.
- **Golden suite:** `e2e/golden/auth.setup.ts` seeds the dismissal key before sign-in so specs
  assert the established shell, not the guide (the demo scene never mounts there either — the tour
  only launches from the guide, the empty states, or Settings).
