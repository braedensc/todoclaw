// The two work-region views swapped by the embedded Grid/List toggle (ViewToggle). Kept in
// their own module (not in ViewToggle.tsx) so that component file exports only a component —
// required for React Fast Refresh (react-refresh/only-export-components).
//
// Done is no longer one of these (B8): it left the main view set and opens as a header panel,
// mirroring Backups. So the toggle swaps ONLY grid ⇄ list; header/plan/input/habits stay put.

export type WorkView = 'grid' | 'list'

// Icons are decorative unicode glyphs (aria-hidden in ViewToggle) — no icon library in this
// project (warm-paper theme uses glyphs, matching the original's icon + label treatment).
export const WORK_VIEWS: { id: WorkView; label: string; icon: string }[] = [
  { id: 'grid', label: 'Grid', icon: '⊞' },
  { id: 'list', label: 'List', icon: '☰' },
]
