import type { RefObject } from 'react'
import type { Task } from '../../types/task'
import { daysUntil } from '../../lib/scoring'
import { useConfirm } from '../../components/use-confirm'
import { ViewToggle } from '../../components/ViewToggle'
import type { WorkView } from '../../components/tabs'
import { GridCanvas } from './GridCanvas'
import { GridCard } from './GridCard'
import { GridAxes } from './GridAxes'
import { ClusterBubble } from '../clustering/ClusterBubble'
import { ClusterPopup } from '../clustering/ClusterPopup'
import type { GridApi } from './use-grid'

interface GridSurfaceProps {
  grid: GridApi
  /** The canvas surface ref the drag hooks bind to (created by WorkArea, shared with useGrid). */
  gridRef: RefObject<HTMLDivElement>
  view: WorkView
  onSelectView: (view: WorkView) => void
  /** True while the grid is expanded to (near-)fullscreen. */
  expanded: boolean
  onToggleExpanded: () => void
}

/**
 * The dominant grid surface: the free-canvas GridCanvas with its placed cards / cluster bubbles,
 * the embedded Grid⇄List toggle notched into its top border, a fullscreen Expand control in the
 * top-right corner, and the long axis arrows drawn just outside the edges (B8, item 4). All the
 * drag/placement state comes from the shared `useGrid` api; this component is the canvas render.
 */
export function GridSurface({
  grid,
  gridRef,
  view,
  onSelectView,
  expanded,
  onToggleExpanded,
}: GridSurfaceProps) {
  const {
    timeZone,
    placedTasks,
    clusters,
    draggedTask,
    draggingId,
    registerCardNode,
    startReposition,
    updateMutate,
    softDeleteMutate,
    handleDone,
    openClusterId,
    setOpenClusterId,
    startPopupRowDrag,
    handleGridPointerDown,
    clusterDominant,
    clusterAccentColor,
    clusterNearestDue,
    urgencyGlowStyle,
  } = grid

  const confirm = useConfirm()

  // Delete now confirms first (was a silent soft-delete), mirroring the List/cluster surfaces (B9).
  // The app-themed useConfirm gate names the task so an accidental click can't quietly remove it.
  const handleDelete = async (task: Task) => {
    if (
      await confirm({ title: `Delete “${task.text}”?`, message: 'This removes it from your grid.' })
    )
      softDeleteMutate(task.id)
  }

  // One placed card. Shared by the singleton-cluster render and the standalone dragged-card
  // render so both stay byte-for-byte identical (same handlers, same node registration). All of
  // due/recurring/rename reuse the one generic updateMutate({ id, patch }); a due write sets `due`
  // ONLY — it never touches x/y, so setting a due date on a manually-placed card can't move it.
  const renderGridCard = (task: Task & { x: number; y: number }) => (
    <GridCard
      key={task.id}
      task={task}
      screenX={task.x}
      screenY={1 - task.y}
      daysUntilDue={daysUntil(task.due, { timeZone })}
      dragging={draggingId === task.id}
      cardRef={(node) => registerCardNode(task.id, node)}
      onPointerDown={startReposition(task.id)}
      onRename={(text) => updateMutate({ id: task.id, patch: { text } })}
      onDelete={() => handleDelete(task)}
      onDone={() => handleDone(task)}
      onSetDue={(due) => updateMutate({ id: task.id, patch: { due } })}
      onSetRecurring={(frequencyDays) =>
        updateMutate({
          id: task.id,
          patch: { recurring: { frequencyDays, lastDoneAt: null, doneCount: 0 } },
        })
      }
      onSetFrequency={(frequencyDays) => {
        if (task.recurring)
          updateMutate({ id: task.id, patch: { recurring: { ...task.recurring, frequencyDays } } })
      }}
      onRemoveRecurring={() => updateMutate({ id: task.id, patch: { recurring: null } })}
    />
  )

  // Render groups = the clusters (over every card EXCEPT the one being dragged) PLUS the dragged
  // card appended as its own standalone singleton group. Appending it here — rather than in a
  // separate trailing JSX slot — keeps its keyed <GridCard> inside the SAME children array across
  // the drag start, so React MOVES the node instead of unmount+remounting it. A remount would
  // destroy the pointer-down target mid-drag and the browser would fire pointerup, aborting the
  // drag (it never lifts). The dragged card still never folds into a bubble (it's excluded from
  // clustering) and always has a live node for the per-frame direct-DOM moves.
  const groups = draggedTask ? [...clusters, [draggedTask]] : clusters

  return (
    // Outer wrapper reserves the outside gutters (pl / pb) the axis arrows live in. When expanded
    // it becomes a fixed near-fullscreen overlay; the canvas keeps its aspect ratio but grows to
    // fill the viewport height (max-width derived from the available height).
    <div
      className={
        expanded
          ? 'fixed inset-0 z-50 flex flex-col items-center overflow-auto bg-bg py-8 pl-8 pr-4'
          : 'relative pb-6 pl-5'
      }
    >
      {/* The canvas is aspect-locked (1046/640), so height follows width. INLINE, the grid is
          DOMINANT by filling its (now wider, 1280px) column edge-to-edge; the chat push-drawer
          shrinks that column so the grid reflows smaller with it (B2). A tall grid may run past
          the fold on short windows (the Expand control gives a fit-to-height fullscreen view) —
          that's the trade for a big, column-filling grid. EXPANDED is the reverse: a height-driven
          max-width so the fullscreen canvas fits the viewport height exactly. */}
      <div
        className="relative mx-auto w-full"
        style={expanded ? { maxWidth: 'calc((100vh - 130px) * 1046 / 640)' } : undefined}
      >
        {/* Embedded Grid⇄List toggle — notched into the canvas's top border line. */}
        <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
          <ViewToggle view={view} onSelect={onSelectView} />
        </div>

        {/* Fullscreen Expand / collapse (EisenClaw parity — protects grid height). */}
        <button
          type="button"
          onClick={onToggleExpanded}
          aria-label={expanded ? 'Exit fullscreen grid' : 'Expand grid to fullscreen'}
          title={expanded ? 'Exit fullscreen' : 'Expand'}
          className="absolute right-1.5 top-1.5 z-20 flex h-[22px] w-[22px] items-center justify-center rounded-md border border-border-strong bg-panel text-[13px] leading-none text-muted shadow-sm hover:bg-card hover:text-ink"
        >
          {expanded ? '⤡' : '⤢'}
        </button>

        <GridAxes />

        <GridCanvas surfaceRef={gridRef} onBackgroundPointerDown={handleGridPointerDown}>
          {placedTasks.length === 0 && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted">
              No tasks placed — add one above and drag it here.
            </p>
          )}

          {groups.map((group) => {
            // A singleton group renders as a normal, draggable card.
            if (group.length === 1) {
              return renderGridCard(group[0] as Task & { x: number; y: number })
            }

            // Overlapping group → a single bubble at the dominant task's coords, with the
            // expandable popup. Accent/dominant come from lib/clustering (recurring-aware).
            const dominant = clusterDominant(group, { timeZone })
            const accentColor = clusterAccentColor(group, { timeZone })
            const clusterMinD = clusterNearestDue(group, { timeZone })
            const open = openClusterId === dominant.id
            return (
              <ClusterBubble
                key={dominant.id}
                group={group}
                accentColor={accentColor}
                screenX={dominant.x ?? 0.5}
                screenY={1 - (dominant.y ?? 0.5)}
                glow={urgencyGlowStyle(clusterMinD)}
                open={open}
                onToggle={() => setOpenClusterId(open ? null : dominant.id)}
                // Register the bubble node under the dominant id (same key `memberToNodeKey` uses)
                // so the merge preview can flag this bubble when a drag would merge into it.
                bubbleRef={(node) => registerCardNode(dominant.id, node)}
              >
                {open && (
                  <ClusterPopup
                    group={group}
                    accentColor={accentColor}
                    dominantY={dominant.y ?? 0.5}
                    timeZone={timeZone}
                    onDone={handleDone}
                    onEdit={() => setOpenClusterId(null)}
                    onDelete={(task) => {
                      softDeleteMutate(task.id)
                      setOpenClusterId(null)
                    }}
                    onRowPointerDown={startPopupRowDrag}
                  />
                )}
              </ClusterBubble>
            )
          })}
        </GridCanvas>
      </div>
    </div>
  )
}
