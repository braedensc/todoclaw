import { useRef, useState } from 'react'
import { ViewToggle } from '../../components/ViewToggle'
import type { WorkView } from '../../components/tabs'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { useGrid } from '../grid/use-grid'
import { GridSurface } from '../grid/GridSurface'
import { ListView } from '../list/ListView'
import { MobileMatrix } from './MobileMatrix'
import { TaskInputWidget } from './TaskInputWidget'
import type { ChatController } from '../ai/use-chat-controller'

// The work region of the shell (B8). On DESKTOP it owns the shared grid drag/placement state
// (useGrid) and the Grid⇄List `view`, laying out the one input widget above the swapped Grid/List
// content (each with the embedded toggle notched into its top border).
//
// On MOBILE (< 720px, ADR-0028) there is no grid and no Grid/List toggle — MobileMatrix (the
// quadrant overview→focus list) is the ONLY task surface, and adding is owned by the bottom nav's
// "+" (MobileAddSheet), so no input widget renders here either. A compact Daily-reminders inline
// list renders ABOVE this (in AppShell).
//
// `gridOnly` (the desktop-only "Grid-only view" pill) is the exception: it renders ONLY the
// fullscreen grid. `onExitGridOnly` (also wired to Esc in AppShell) returns to the normal layout.
export function WorkArea({
  chat,
  onOpenChat,
  gridOnly,
  onExitGridOnly,
}: {
  chat: ChatController
  onOpenChat: () => void
  gridOnly: boolean
  onExitGridOnly: () => void
}) {
  // The canvas surface ref — created here, shared between useGrid (drag hooks) and GridSurface.
  const gridRef = useRef<HTMLDivElement>(null)
  const grid = useGrid(gridRef)
  const [view, setView] = useState<WorkView>('grid')
  const isMobile = useIsMobile()

  // Mobile: the quadrant overview→focus list IS the work region — no grid, no toggle, no input
  // widget (adding lives in the bottom nav's "+"). ADR-0028.
  if (isMobile) {
    return (
      <section aria-label="Workspace" className="flex flex-col">
        <MobileMatrix />
      </section>
    )
  }

  // Grid-only mode (desktop): the fullscreen grid overlay is the entire work region. The input
  // widget, the Grid⇄List toggle, and the List are all dropped; the overlay carries its own Exit.
  if (gridOnly) {
    return (
      <GridSurface
        grid={grid}
        gridRef={gridRef}
        view="grid"
        onSelectView={setView}
        gridOnly
        onExitGridOnly={onExitGridOnly}
      />
    )
  }

  return (
    <section aria-label="Workspace" className="flex flex-col">
      <TaskInputWidget grid={grid} chat={chat} canPlace={view === 'grid'} onOpenChat={onOpenChat} />

      {/* Work content. mt clears the toggle that straddles the content's top border. */}
      <div className="mt-5">
        {view === 'grid' ? (
          <GridSurface
            grid={grid}
            gridRef={gridRef}
            view={view}
            onSelectView={setView}
            gridOnly={false}
            onExitGridOnly={onExitGridOnly}
          />
        ) : (
          <div className="relative">
            <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
              <ViewToggle view={view} onSelect={setView} />
            </div>
            <ListView />
          </div>
        )}
      </div>
    </section>
  )
}
