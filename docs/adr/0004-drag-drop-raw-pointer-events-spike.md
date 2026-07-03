# ADR-0004 — Drag/drop = raw Pointer Events (spike resolved)

**Date:** 2026-06-23 · **Stage:** 1 deferral → **resolved Stage 3 (PR #1)**

**Background (Stage 1):** the master plan calls for spiking @dnd-kit vs. raw pointer events for
the free-canvas grid. Stage 1 only proves the pipeline (toolchain → DB → auth → render), so the
spike was deferred to Stage 3 where the grid is built.

**Decision (Stage 3): use raw Pointer Events.** We built both prototypes (a throwaway
`spike.html` bake-off) and drove them in the browser — desktop pointer + emulated touch, at a
<720px viewport. Findings:

| | Raw Pointer Events | @dnd-kit/core |
|---|---|---|
| Continuous free placement | native — `(clientX-left)/width`, y-inverted | must reconstruct from `delta`; **same manual math anyway** |
| Mouse + touch + pen | one handler set (Pointer Events API) | sensor abstraction (PointerSensor/TouchSensor) |
| Mobile tap-to-place | trivial (select → tap surface) | not native; bespoke |
| Tray→grid / popup drag-out (cross-container) | same handler, no extra wiring | needs droppable registration |
| Testability | drove it deterministically with synthetic events (drag → `0.200/0.800`, tap → `0.800/0.700`) | PointerSensor did **not** respond to synthetic events — a real unit/E2E cost |
| Dependency | none | +4 packages |

@dnd-kit is excellent for sortable lists / discrete droppables, but the free-canvas model
(continuous coords, custom clustering, no snap targets) cuts against its grain — it adds an
abstraction without removing the coordinate math we'd write regardless. The chosen primitive
ships as `src/hooks/use-free-drag.ts` (with a pure, unit-tested `toNormalized` helper); the
`spike.html`/`src/spike/` scaffold and the `@dnd-kit` dependency were removed after the decision.

**Related — Realtime deferred to Stage 5.** RLS scopes every user to their own rows, so Supabase
Realtime would only help the *same* user on two devices at once; TanStack Query's
`refetchOnWindowFocus`/`refetchOnReconnect` plus **date-keyed `daily_state` queries** cover Stage
3's needs. The Stage-3 atomic merge-RPC (see the Done/history work) makes adding Realtime later
purely additive — no write-path rework — so there is no cost to waiting.
