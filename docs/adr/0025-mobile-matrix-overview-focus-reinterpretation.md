# ADR-0025 — Mobile matrix: overview→focus reinterpretation (Concept C)

**Date:** 2026-07-06 · **Stage:** post-launch (mobile redesign) · **Status:** Superseded in part by [ADR-0028](0028-mobile-list-only-no-grid-single-add-sheet.md) — the mobile grid was later removed; the overview→focus model still holds

The `eisenclaw.md` parity spec models one free-canvas 2D grid. On a phone that grid is a poor fit
for a thumb — 112px cards on a ~375px viewport, 18px controls, overlaps collapsing into cluster
popups that overflow the screen. Rather than perfect pixel-dragging on touch (which NN/g and every
serious matrix app avoid), we reinterpret the matrix on mobile only. Desktop is byte-for-byte
unchanged; everything here gates behind the existing `< 720px` breakpoint (`useIsMobile`,
ADR-0020). This is a deliberate, documented per-platform deviation from the single-canvas spec —
mirroring the ADR-0014/0015 precedent for mobile-era decisions — not a regression.

Decisions:

- **Split the matrix's two jobs into two views.** A phone can't do "see all four quadrants at a
  glance" and "work inside one quadrant" well on one screen, so mobile gets an **overview** (a
  read-only 2×2 minimap: per-quadrant count + density bar + top-scored task preview) that drills
  into a **focus** list (one quadrant as a comfortable full-width list). This is the dominant,
  proven pattern (Focus Matrix Grid/Focus). Overview answers "what's on fire"; focus is where real
  work happens.
- **On mobile the QUADRANT is the unit of meaning; intra-quadrant x/y is approximate.** The focus
  list ranks by the same `taskScore`, but fine position within a quadrant is treated as
  auto-settled (by the existing collision spiral + clustering), not something a thumb sets. Exact
  free-canvas placement remains a **desktop/pointer** affordance. No stored data changes:
  `quadrantMeta` (split at 0.5, HIGH side owns the boundary), scoring, `resolveCollision`, and
  clustering are all reused untouched, so a phone user's tasks render identically back on desktop.
- **Reuse, don't rebuild.** Focus mode is the existing `ListView` scoped by the `quadrantFilter`
  prop (PR #113); rows keep every ListView interaction (complete / edit / delete / expand /
  recurring). The overview reads a pure `summarizeQuadrants()` helper (`src/lib/`). New surface is
  just the `MobileMatrix` orchestrator + a segmented quadrant pager.
- **The mobile "List" view hosts it; the Grid view stays intact.** `WorkArea` renders `MobileMatrix`
  instead of the flat `ListView` only when `useIsMobile()`; desktop List is unchanged. The Grid view
  is deliberately kept on mobile in this slice so tap-to-place add/placement (ADR-0004) still works
  — nothing is lost while the tap-based **Move-to-quadrant** and **create-into-quadrant** sheets
  land in follow-ups (they'll use the `BottomSheet` primitive, PR #116). The `<nav aria-label=
  "Views">` toggle and its golden `switchTab` selector are untouched.
- **Unplaced/staged tasks are not bucketed.** They carry no real quadrant, so the overview skips
  them (they stay reachable + placeable in the Grid view for now); a dedicated "Unplaced" affordance
  arrives with the create-into-quadrant sheet.

**Verified.** typecheck / lint / format green; +11 unit tests (`summarizeQuadrants` bucketing +
`MobileMatrix` overview→focus→pager→back); full suite green. Browser-verified at a 390px viewport:
the mobile List view shows the 2×2 overview, a cell drills into its quadrant list, the pager switches
quadrants, and back returns. Follow-ups: the move/add `BottomSheet` sheets, then Concept D chrome.
