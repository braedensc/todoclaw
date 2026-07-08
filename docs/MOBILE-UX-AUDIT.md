# Mobile UX Audit — 2026-07-08

A holistic walkthrough of the phone experience (`< 720px`), grounded in a live browser session
(375×812 and 320×568, seeded with realistic data) plus a full read of the mobile code surface.
Each finding cites code and carries a priority. The bottom section maps the accepted findings to
the implementation PRs.

**Verdict up front:** the mobile foundation is genuinely good — thumb-zone bottom nav, a real
sheet primitive with focus trap + scroll lock, `dvh` sizing, safe-area insets, comprehensive
`prefers-reduced-motion` guards, and the overview→focus matrix is a smart phone-native
reinterpretation of the grid. The gaps are concentrated in **fine motor ergonomics** (sub-44px
targets, 14px inputs that make iOS zoom), **two real layout bugs**, **contrast of the lightest
text tier**, and **consistency between the sheet system and the three hand-rolled modals**.

---

## Priority key

- **P0** — broken today (visible bug)
- **P1** — high-value, low-risk; implemented in the follow-up PRs
- **P2** — worthwhile, slightly more invasive; implemented where noted
- **P3 / Owner** — product or visual-direction decisions surfaced for Braeden, not shipped

---

## 1. Bugs found on screen (P0)

### 1.1 Expanded row: Importance number input overflows the card
At 375px, the Importance value box renders past the card edge by ~10px (measured: input right
edge 344px vs card right edge 334px). The Urgency row fits only because its label is narrower.
Cause: each `label + slider + number` cluster in `ExpandedRow` is a flex child that can't shrink
(`min-width: auto`) and the slider has a fixed `w-32`.
**Fix:** let the slider flex/shrink inside the cluster so the trio always fits the card width.
— `src/features/list/ExpandedRow.tsx`

### 1.2 320px phones: header forces page-wide horizontal scroll
The "✦ Plan My Day" pill is `whitespace-nowrap`; at 320px (iPhone SE class) it overflows the
viewport by ~20px and the whole app pans horizontally.
**Fix:** let the header row shrink — compact pill label below ~360px (icon + "Plan"), and
`min-w-0` on the header flex children.
— `src/App.tsx` mobile header

---

## 2. Touch targets & one-handed use

### 2.1 Row action buttons are 32×32 (P1)
`IconButton` is `h-8 w-8` (32px) — below the 44pt/48dp guideline — and it powers the *primary*
mobile actions: Move ⊞ / Done ✓ / Delete × on every list row, Restore ↩ / Delete × on Done
history rows. Delete sits directly beside Done, so the mis-tap cost is destructive.
**Fix:** on mobile, render these at ≥44px hit size (larger box + slightly larger glyph); desktop
keeps its current density via the `wide:` variant.
— `src/components/IconButton.tsx:46`, `src/features/list/ListRow.tsx:270-304`,
`src/features/done/DoneView.tsx:110-129`

### 2.2 Habit / reminder controls are far below target size (P1)
Measured in the Daily-reminders sheet: checkbox 16×16, delete × 20×24, "steps" expander 22px
tall. Reminder pills on home are 26px tall.
**Fix:** ≥44px hit areas on mobile — grow the checkbox, pad the delete/steps controls, make the
whole row line tappable for the checkbox, bump pill padding.
— `src/features/habits/HabitRow.tsx:60-63,75,91,106-124`, `src/features/habits/RemindersInline.tsx:73-83`

### 2.3 Slider thumbs are the primary prioritization control and are 16px tall (P1)
Urgency/importance sliders in the expanded row are `w-32` × 16px native ranges, styled default
blue (also a theme clash — see §7.2).
**Fix:** style the range inputs (accent color + larger thumb + taller hit area) and let the track
flex wider on mobile.
— `src/features/list/ExpandedRow.tsx:132`

### 2.4 What's already right
Bottom nav items are `min-h-[64px]`; focus-view back button is 44px; quadrant pickers are
56–128px cells; More-sheet rows are 52px. The primary chrome was clearly built thumb-first —
the small stuff just didn't follow yet.

---

## 3. Keyboard & input ergonomics

### 3.1 iOS zooms the page on every input focus (P1, systemic)
Nearly every input is `text-sm` (14px). iOS Safari auto-zooms the viewport when focusing any
input under 16px — so Add task, chat, habit add, settings, auth all trigger a zoom-in that the
user has to pinch back out of. This is the single most annoying mobile-web paper cut.
**Fix:** one mobile-only CSS rule — at `< 720px`, form controls get `font-size: 16px`. No
desktop change, no per-component churn.
— `src/index.css` (new rule); instances across `AddTaskSheet`, `ChatConversation`, `HabitRow`,
`ListRow`, `ExpandedRow`, `SettingsPanel`, `AuthForm`

### 3.2 No `enterkeyhint` / `inputmode` anywhere (P1)
Zero hits repo-wide. Consequences: chat and add-task show a generic "return" key instead of
**Send**/**Done**; urgency/importance/recurring-days/free-hours number fields open the full
alphanumeric keyboard instead of the numeric pad.
**Fix:** `enterkeyhint="send"` (chat), `"done"` (add task, habit add, auth),
`inputMode="numeric"` on the numeric fields.
— `ChatConversation.tsx:111`, `AddTaskSheet.tsx:109`, `ExpandedRow.tsx:142`,
`RecurringSection`, `SettingsPanel.tsx:309-334`, `HabitsView.tsx:165`

### 3.3 Chat input can sit behind the iOS keyboard (P2)
`ChatPanel` is `absolute bottom-0 h-[92dvh]` with the composer last. iOS does not shrink the
layout viewport for the keyboard and there's no `visualViewport` handling, so in standalone PWA
the composer can be covered while typing.
**Fix:** track `window.visualViewport` (resize/scroll) while the chat sheet is open and lift the
composer by the keyboard overlap. Also harmless to add `interactive-widget=resizes-content` for
Android Chrome.
— `src/features/ai/ChatPanel.tsx:36-41`, `index.html:8`

---

## 4. Navigation & flows

### 4.1 No touch path to rename a task (P1)
Inline edit is `onDoubleClick` (mouse) or `F2` (keyboard). On a phone there is no visible edit
affordance at all — the only rename path is asking BabyClaw.
**Fix:** an explicit ✎ Rename control in the expanded row on mobile that enters the existing
edit state.
— `src/features/list/ListRow.tsx:113-118,237-244`

### 4.2 Adding a task gives zero feedback (P1)
The add sheet closes silently. If you're focused on *Do Now* and add to *Errands*, nothing on
screen changes — the task went somewhere you can't see, with no confirmation. (Verified live:
Errands count 5→6 was the only signal, off-screen.)
**Fix:** a small transient toast — "Added to Errands ✓" — with `aria-live="polite"`.

### 4.3 Add sheet ignores the quadrant you're looking at (P2)
`MobileAddSheet` hardcodes `defaultQuadrant={null}` even when opened from inside a focused
quadrant list. The user must re-pick the quadrant they're already in.
**Fix:** lift the focused-quadrant state so the add sheet pre-selects it (still changeable).
— `src/features/shell/MobileAddSheet.tsx:44`, `src/features/shell/MobileMatrix.tsx:42`

### 4.4 Add sheet layout: the pickers live at the top, the thumb lives at the bottom (P1)
The full-screen add sheet puts the quadrant picker in the top reach-hostile zone with ~60% dead
space between it and the bottom composer.
**Fix:** bottom-cluster the whole form (picker directly above the composer row), keeping the
sheet header for title/close.
— `src/features/shell/AddTaskSheet.tsx:69-124`

### 4.5 Quadrant focus is invisible to the router (P2 — implemented as history entry)
Entering a quadrant focus list is `useState` only; Back (browser/hardware/edge-swipe) exits the
app surface instead of returning to the overview — the one place the mobile app breaks the
"Back goes up" rule that Done/reminders/chat already honor.
**Fix:** push a history entry when entering focus so Back pops to overview (no new route
needed; popstate → clear focus).

### 4.6 Setup guide dominates the first screen (P2)
On first run the "Get set up" card fills ~55% of the viewport and pushes the actual task matrix
below the fold; it stays that size on every launch until dismissed or completed.
**Fix (mobile only):** start collapsed to a one-line banner ("Get set up · 1/3 ▸") that expands
on tap.
— `src/features/onboarding/`

### 4.7 Sign out is a single tap in the More sheet (P2)
Adjacent to Backups, no confirm; a mis-tap costs a full re-login (and on a PWA, possibly lost
push registration state). **Fix:** reuse the existing confirm dialog.
— `src/features/shell/MoreSheet.tsx:68`

---

## 5. The sheet system

### 5.1 Grab handles promise a gesture that doesn't exist (P1)
Every `BottomSheet` renders the standard grab handle, but there is no swipe-to-dismiss — the
handle is decoration; only scrim-tap/Escape close. On iOS this reads as "broken" because every
system sheet drags.
**Fix:** pointer-based drag-to-dismiss on `BottomSheet` (follow the finger below the origin,
close past distance/velocity threshold, spring back otherwise; respects reduced-motion by
snapping). One primitive fixes Move/More/Add/Reminders at once.
— `src/components/BottomSheet.tsx`

### 5.2 Chat is a sheet without the sheet affordances (P2)
`ChatPanel` is hand-rolled: rounded top corners like a sheet, but no grab handle and no swipe.
**Fix:** add the handle + the same drag-to-dismiss (its header is a natural drag region).
— `src/features/ai/ChatPanel.tsx`

### 5.3 Three overlay dialects (P2 / partly Owner)
Current inventory: bottom sheets (Move/More/Add/Reminders), top-anchored card modals
(Inbox, reminder-pill detail), centered scrolling modal (Settings, Backups). The reminder-pill
detail modal additionally lacks focus trap and scroll lock.
**Fix now:** convert the reminder-pill detail to `BottomSheet` (small, isolated).
**Owner decision:** whether Settings/Backups/Inbox should become sheets too — bigger visual
change, desktop shares the code.
— `src/features/habits/RemindersInline.tsx:86-91`, `src/features/settings/SettingsPanel.tsx:216`,
`src/features/notifications/InboxPanel.tsx:24`

---

## 6. Contrast & accessibility

### 6.1 `text-muted-light` fails contrast, and it's used at 10px (P1)
Measured on the panel background: **2.92:1** (AA needs 4.5:1 for small text; even large-text AA
needs 3:1). It's the color of quadrant subtitles, timestamps, "+N more", "Current" tags — often
at `text-[10px]`. `text-muted` measures 4.31:1 — borderline.
**Fix:** darken the two tokens just enough to clear 4.5:1 / ~4.6:1 while keeping the warm hue
(this intentionally shifts desktop too — same readability problem there).
— `tailwind.config.js` palette

### 6.2 Focus visibility is inconsistent (P2)
Only 5 files set `focus-visible` styles; several inputs suppress the UA outline
(`focus:outline-none`) and replace it with a border-color change only — nearly invisible.
IconButtons, nav tabs, and sheet buttons rely on the UA default ring, which the warm palette
sometimes swallows.
**Fix:** a global `:focus-visible` ring in `index.css` matching the app's accent, replacing the
scattered per-component approach over time.

### 6.3 Chat bubbles can overflow on long tokens (P1, one-liner)
Bubbles are `whitespace-pre-wrap` without `break-words`; one long URL stretches the row past
the sheet edge. List rows already solved this.
— `src/features/ai/ChatConversation.tsx:145-151`

### 6.4 Empty-state copy is desktop-flavored on mobile (P1, copy-only)
"No tasks yet — add one from the header." On a phone the add path is the ➕ tab.
— `src/features/list/ListView.tsx:92-94`

### 6.5 Already strong
Reduced-motion guards on every keyframe; semantic dialogs with traps in `BottomSheet`/
`ConfirmDialog`; `aria-expanded` list rows; `aria-current` nav; ref-counted body scroll lock;
`overscroll-contain` on internal scrollers. Good bones.

---

## 7. Visual & typography notes

### 7.1 Sub-12px text is common (P2, partial)
`text-[9px]`–`text-[11.5px]` appear across the minimap, badges, pager counts. At normal phone
distance these are strainingly small, and they compound with §6.1. The P1 contrast fix + the
worst-offender bumps (quadrant subtitles, "+N more") land together; a systematic type-scale pass
is left as a follow-up.

### 7.2 Default-blue native controls clash with the warm palette (P1)
Range sliders (and date/number focus accents) render browser-default blue inside an otherwise
tightly art-directed warm-paper UI. `accent-color` + a styled thumb bring them into the family.
— `src/features/list/ExpandedRow.tsx`, `src/index.css`

### 7.3 Dark mode does not exist (Owner)
Light-only palette; no `dark:` variants. Two consequences worth knowing: (a) dark-preference
users get a bright app at night; (b) in iOS standalone, `black-translucent` draws **white**
status-bar glyphs over the warm-paper background — effectively invisible. A real dark theme is a
visual-direction project; the status-bar contrast could be mitigated sooner if desired.

---

## 8. State coverage & PWA (observations, no action needed)

- Loading/error/empty states exist on every surface walked (list, matrix, done, chat, plan box —
  including the budget-paused chat banner and Plan-My-Day retry card). Empty states even have
  the sleeping-puppy illustration. Skeletons could replace "Loading…" text later; not urgent.
- Safe areas: top inset on body, bottom inset on nav + sheets, `viewport-fit=cover` present.
  `#root` is the only scroller below 720px — no rubber-band page scroll. Verified no horizontal
  overflow at 375px (320px bug aside).
- No console errors across the entire walkthrough.

---

## 9. Surfaced for Braeden (not shipped)

| Topic | Question |
|---|---|
| Dark mode | Worth a full dark palette pass? (§7.3 — also fixes the standalone status-bar glyphs) |
| Swipe actions on rows | Swipe-right = Done / swipe-left = Delete is the native todo-app idiom; high value, but a gesture-conflict + golden-spec project of its own |
| Rapid multi-add | Should the add sheet stay open after adding (clear + "Added ✓") for batch entry? Today it closes per task |
| Settings/Backups/Inbox as sheets | Unify the last three non-sheet overlays? (§5.3) |
| Quadrant focus as a route | The history-entry fix (§4.5) ships; full `#/q/do-now` deep links are possible later |

---

## 10. Implementation plan (Phase 2 PRs)

| PR | Scope | Findings |
|---|---|---|
| **A. docs** | This report + stale-doc fixes (STYLE.md responsive section, grid README tap-to-place, CLAUDE.md breakpoint note — all still describe the pre-ADR-0028 mobile grid) | §doc-drift |
| **B. fix: mobile layout bugs** | Expanded-row overflow; 320px header overflow | 1.1, 1.2 |
| **C. feat: mobile ergonomics** | 44px targets (rows, done page, habits, pills); 16px inputs; `enterkeyhint`/`inputMode`; slider styling + size; chat `break-words`; empty-state copy; global focus-visible ring; muted-token contrast | 2.1–2.3, 3.1, 3.2, 6.1, 6.3, 6.4, 6.2, 7.2 |
| **D. feat: one sheet system** | Swipe-to-dismiss in BottomSheet; chat handle + swipe; reminder-detail modal → BottomSheet | 5.1, 5.2, 5.3 |
| **E. feat: add-task flow** | Thumb-zone form layout; added-toast; pre-selected focus quadrant; Back pops quadrant focus | 4.2, 4.3, 4.4, 4.5 |
| **F. feat: small flows** | Mobile rename affordance; collapsed setup guide on mobile; sign-out confirm; chat keyboard (visualViewport) | 4.1, 4.6, 4.7, 3.3 |

Constraints honored throughout: golden-test hooks preserved (`nav[aria-label="Account"]` +
"Done" button, `aria-expanded` rows, existing labels); desktop behavior untouched except where
explicitly cross-cutting (contrast tokens, focus ring); all work in feature-branch PRs, merging
left to the owner.
