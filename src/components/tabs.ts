// Tab identifiers and labels for the top-level view nav. Kept in their own module (not in
// TabNav.tsx) so that component file exports only a component — required for React Fast
// Refresh (react-refresh/only-export-components).

export type Tab = 'grid' | 'list' | 'done'

// Icons are decorative unicode glyphs (aria-hidden in TabNav), matching the original's
// icon + label tab treatment (pics/Todopic1.jpeg) — no icon library in this project.
export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'grid', label: 'Grid', icon: '⊞' },
  { id: 'list', label: 'List', icon: '☰' },
  { id: 'done', label: 'Done', icon: '✓' },
]
