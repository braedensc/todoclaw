# ADR-0026 — Mobile chrome: slim top bar + thumb-zone bottom nav (Concept D)

**Date:** 2026-07-06 · **Stage:** post-launch (mobile redesign) · **Status:** Accepted

On a phone the signed-in header stacked eight blocks — wordmark, Plan, Grid-only pill, a marketing
tagline, a five-link account nav, plan card, reminders, input — before any task was visible. Concept
D reclaims the fold: below 720px the tall header becomes a slim top bar (wordmark + Plan only) and
the account/utility actions move into a thumb-zone bottom nav plus a "More" overflow sheet. Desktop
is unchanged. Completes the mobile redesign started in ADR-0025.

Decisions:

- **JS-gate the chrome, don't just CSS-hide it.** `AppShell` branches on `useIsMobile()` and renders
  EITHER the desktop header OR the mobile top bar + bottom nav — never both. This is deliberate: the
  golden E2E `openDone` selects `nav[aria-label="Account"]` and the shell smoke test asserts a
  *unique* `Done`/`Reminders` button. CSS-only `wide:` hiding leaves both navs in the DOM (jsdom and
  the a11y tree), making those selectors ambiguous. JS-gating guarantees exactly one `Account` nav
  per environment, so the golden helpers and `App.test` keep working untouched.
- **Keep the Grid/List switch as the embedded ViewToggle.** The bottom nav hosts Add / Reminders /
  Done / More; view switching stays the in-work-area `ViewToggle` (`nav[aria-label="Views"]`),
  unrelocated. This keeps `switchTab` and the mobile golden spec's "Views nav visible" assertion
  green with zero change, and avoids touching WorkArea/GridSurface.
- **The bottom nav is `<nav aria-label="Account">` with a real "Done" button** so `openDone` works
  on mobile exactly as on desktop. Settings / Backups / Grid-only view / Sign out (rare or
  destructive) go to the More bottom sheet — the top/red-zone-equivalent, harder-to-reach-by-design.
- **"+" is a shortcut to the existing capture input, not a new add surface.** It scrolls the inline
  Manual/BabyClaw input into view and focuses it, leaving the grid tap-to-place flow — and the
  golden `tapPlaceTask` helper — untouched. A richer create sheet can replace it later without
  re-plumbing the grid state that lives in WorkArea.
- **Reuse the BottomSheet primitive** (ADR-0025 / PR #116) for the More sheet, and pad the mobile
  content column (`pb-24`) so the fixed bottom nav never covers a task. Both bars are hidden in
  grid-only mode.

**Verified.** typecheck / lint / format green; +5 unit tests (bottom-nav Account/Done contract +
callbacks, More-sheet items + close-on-tap); `App.test` unchanged and green; full suite green. The
slim top bar + bottom nav + More sheet were browser-verified at 375px in isolation. Because this
reworks nav the mobile golden spec asserts, **run the golden suite before merging** — it was not run
in the authoring session (no local Docker Supabase). Expected to pass unchanged (Views nav, Account/
Done, and tap-to-place are all preserved), but confirm.
