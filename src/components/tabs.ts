// Tab identifiers and labels for the top-level view nav. Kept in their own module (not in
// TabNav.tsx) so that component file exports only a component — required for React Fast
// Refresh (react-refresh/only-export-components).

export type Tab = 'grid' | 'list' | 'done' | 'habits'

export const TABS: { id: Tab; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'list', label: 'List' },
  { id: 'done', label: 'Done' },
  { id: 'habits', label: 'Habits' },
]
