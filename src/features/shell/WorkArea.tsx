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

// The work region of the shell (B8). It owns the shared grid drag/placement state (useGrid) and the
// Grid⇄List `view`, and lays out:
//   - the one input widget (Manual staging chips share the same grid state), which STAYS PUT
//   - the swapped content below: the Grid canvas OR the List, each with the embedded toggle
//     notched into its own top border.
// A compact Daily-reminders inline list renders ABOVE this (in AppShell); the full reminders popup
// lives off-page behind the gear-area button. Switching the view swaps ONLY this inner content;
// header / plan / input / reminders are unaffected.
//
// `gridOnly` (driven by the header "Grid-only view" pill in AppShell) is the exception: it renders
// ONLY the fullscreen grid — no input widget, no toggle, no list — so the placed cards get the
// whole screen. `onExitGridOnly` (also wired to Esc in AppShell) returns to the normal layout.
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
  // On a phone the "List" view becomes the quadrant overview→focus experience (MobileMatrix,
  // ADR-0025); desktop keeps the flat ranked ListView. The Grid view is untouched on both, so
  // tap-to-place add/placement still works while the mobile move/add sheets land in follow-ups.
  const isMobile = useIsMobile()

  // Grid-only mode: the fullscreen grid overlay is the entire work region. The input widget, the
  // Grid⇄List toggle, and the List are all dropped (there's nothing but the grid); the overlay
  // carries its own Exit control.
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
            {isMobile ? <MobileMatrix /> : <ListView />}
          </div>
        )}
      </div>
    </section>
  )
}
