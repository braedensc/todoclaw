# ADR-0028 — Mobile is list-only: no grid, one add sheet

**Date:** 2026-07-06 · **Stage:** post-launch (mobile redesign) · **Status:** Accepted · supersedes the mobile grid of [ADR-0020](0020-responsive-layout-one-720px-breakpoint-bottom.md) / [ADR-0025](0025-mobile-matrix-overview-focus-reinterpretation.md)

After using the mobile redesign (ADR-0025/0026), the pixel grid earned its keep only on desktop.
On a phone it added a second, worse way to see the same tasks (a cramped canvas) and a confusing
Grid/List toggle, and it forced the add flow through a grid-placement step. This ADR removes the
grid from mobile entirely. Desktop is unchanged.

Decisions:

- **MobileMatrix is the ONLY mobile task surface.** Below 720px, `WorkArea` renders `MobileMatrix`
  (the quadrant overview→focus list) and nothing else — no `GridSurface`, no `ViewToggle`, no
  `TaskInputWidget`. There is no Grid/List toggle to switch because there is no second view. Desktop
  keeps the grid, the toggle, and the inline input verbatim (JS-gated on `useIsMobile`).
- **One add path: the bottom nav "+" → `MobileAddSheet`.** Adding moved out of MobileMatrix (the
  per-list "+ Add" buttons are gone) and off the top of the screen (no inline input), into a single
  bottom sheet opened by the thumb-zone "+". It carries the same BabyClaw/Manual toggle as desktop,
  reusing the exact `BabyClawInput` and manual `AddTaskForm` components. Both paths produce a
  **placed** task: BabyClaw lets the assistant set placement; Manual is text + a quadrant picker →
  the quadrant center, collision-resolved, `staged:false`. So a phone user never creates a
  "floating" unplaced task and never needs a grid to place one.
  *(Amended 2026-07-08, PR #164: the BabyClaw ⇄ Manual toggle was dropped from `MobileAddSheet` —
  the sheet is manual-only now that the Chat tab owns AI capture; `BabyClawInput` still powers the
  desktop inline widget.)*
- **Reclaimed screen = header + reminders + list.** With the grid, toggle, and input gone, the
  mobile screen is just the slim top bar, the inline daily-reminders row, and the quadrant list —
  which now gets the full width/height. "Reminders" is relabeled **"Daily reminders"** (bottom nav +
  desktop header link). "Grid-only view" is dropped from the mobile More sheet (there's no grid).
- **Golden impact — flagged.** The mobile grid's `tapPlaceTask` and the `Views` toggle no longer
  exist on mobile, so `mobile-flows.mobile.golden.spec.ts` was rewritten around the new add-sheet +
  list flow. `openDone` still works (the bottom nav is `nav[aria-label="Account"]` with a `Done`
  button). **Run the golden suite locally before merging** — it needs the Docker Supabase stack,
  which wasn't available in the authoring session, so the rewritten selectors are unverified.

**Verified (what could be):** typecheck / lint / format green; unit tests updated (MobileMatrix add
tests removed; new `MobileAddSheet` tests; MoreSheet/BottomNav/App label tests updated); full suite
green. `MobileAddSheet` browser-verified at 375px in isolation. Desktop paths untouched. The golden
mobile spec is the one piece pending a local run.
