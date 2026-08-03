# ADR-0027 — Done & Daily reminders as full pages via a minimal hash router

**Date:** 2026-07-06 · **Stage:** post-launch (mobile redesign adjacency) · **Status:** Accepted

"Done" and "Daily reminders" were bottom-of-stack modal overlays (`DonePanel`, `RemindersModal` —
`fixed inset-0 z-50`). On a phone they read as popups over the grid rather than places you go, and
they had no URL, no browser-Back, and no deep link. This converts both to full pages on **both**
breakpoints. There was no router: navigation was `useState` flags in `App.tsx` (`showDone`,
`showReminders`). Adjacent to the mobile redesign (ADR-0025/0026, PRs #113–#121).

Decisions:

- **A minimal hash router, not react-router.** `src/lib/route.ts` is a ~40-line `useRoute()` hook
  (`useSyncExternalStore` over `location.hash`) plus `navigate()` / `goBack()`. Route space is tiny
  (`home | done | reminders`), so a routing library earns nothing here. Two alternatives, both worse
  for this app:
  - _react-router (BrowserRouter, ~13 KB):_ clean `/done` paths, but `vercel.json` has **no SPA
    rewrite** — a hard refresh or shared link to `/done` would 404. Adding a rewrite means new config
    reconciled against the strict CSP. A hash route (`/#/done`) is never sent to the server, so
    refresh and deep links just work. No config.
  - _state-flag view swap (no URL):_ no deep-linking, and browser Back would leave the app unless we
    hand-rolled `pushState`/`popstate` — i.e. reinvent a router. Fails the "native Back" requirement.
  Assigning `location.hash` pushes a history entry, so **browser Back works for free**; Back/Forward
  fire `hashchange`, which the hook subscribes to.

- **Full pages on desktop too — one code path.** The route swaps the home content (header / plan /
  inline reminders / work area) for `DonePage` / `RemindersPage`; the desktop modal is gone. One
  presentation per surface instead of modal-on-desktop + page-on-mobile, and desktop gains
  deep-linking + Back as well. The bodies are unchanged (`DoneView` / `HabitsView`) — only the
  container changed, so history/restore/delete and daily-reminder toggles behave exactly as before.

- **Overlays stay overlays.** Settings, Backups, and Chat remain route-independent modals (rendered
  whenever their flag is set, over any route). They can migrate to routes later with the same hook;
  keeping them modal keeps this change scoped to the two surfaces asked for.

- **The mobile bottom nav drives the routes** (`navigate('done'|'reminders')`) and highlights the
  active destination (`aria-current="page"` + accent) so it reads like tabs. Because the pages are
  inline content (not covering overlays), the bottom nav stays visible on them — so two edges route
  home first: **"+"** (the capture input lives in `WorkArea`, home-only → return home, then focus on
  mount via a ref latch) and **Grid-only view** from the More sheet (the grid-only overlay is
  home-only).

- **Back affordance.** Each page's ✕ (`Close done` / `Close reminders`) calls `goBack()` →
  `history.back()`, matching the browser button. On a cold deep link with no in-app history, `goBack`
  falls back to `navigate('home')` so it never walks off the app.

**Golden contract preserved.** The Done page still exposes `nav[aria-label="Account"] → button "Done"`
→ `region "Done"` and a `Close done` button, so `openDone` / `closeDone` are unchanged. A new
`openReminders` helper mirrors them for the Reminders page.

**Verified.** typecheck / lint / format / unit all green (+ `route.test`, a bottom-nav
active-route test, updated `App.test`). The Done and Daily-reminders golden specs pass against local
Supabase. **Note:** the broader golden suite was already red on `main` before this change — the
capture input defaulted to BabyClaw since #111 (breaking `auth.setup` + every add flow) and the
mobile-redesign / batch-2 reworks left other specs stale (`region "Habits"`, `button "Expand row"`,
`region "Plan My Day"`, mobile card `checkbox "Done"`). This PR includes the minimal unblock so the
suite runs at all (`selectManualMode`) and re-greens the two Done/Reminders specs; the remaining
pre-existing failures are unrelated to routing and want a separate cleanup pass.
