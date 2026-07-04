import { useRef, useState } from 'react'
import { ViewToggle } from '../../components/ViewToggle'
import type { WorkView } from '../../components/tabs'
import { useGrid } from '../grid/use-grid'
import { GridSurface } from '../grid/GridSurface'
import { ListView } from '../list/ListView'
import { TaskInputWidget } from './TaskInputWidget'
import type { ChatController } from '../ai/use-chat-controller'

// The work region of the shell (B8). It owns the shared grid drag/placement state (useGrid), the
// Grid⇄List `view`, and the grid `expanded` flag, and lays out:
//   - the one input widget (Manual staging chips share the same grid state), which STAYS PUT
//   - the swapped content below: the Grid canvas OR the List, each with the embedded toggle
//     notched into its own top border.
// Habits render BELOW this (in AppShell) so they show under both views. Switching the view swaps
// ONLY this inner content; header / plan / input / habits are unaffected.
export function WorkArea({ chat, onOpenChat }: { chat: ChatController; onOpenChat: () => void }) {
  // The canvas surface ref — created here, shared between useGrid (drag hooks) and GridSurface.
  const gridRef = useRef<HTMLDivElement>(null)
  const grid = useGrid(gridRef)
  const [view, setView] = useState<WorkView>('grid')
  const [expanded, setExpanded] = useState(false)

  // Selecting a view always drops fullscreen (the List pane is never fullscreen; and returning to
  // Grid later shouldn't silently re-expand).
  const selectView = (v: WorkView) => {
    setView(v)
    setExpanded(false)
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
            onSelectView={selectView}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((e) => !e)}
          />
        ) : (
          <div className="relative">
            <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
              <ViewToggle view={view} onSelect={selectView} />
            </div>
            <ListView />
          </div>
        )}
      </div>
    </section>
  )
}
