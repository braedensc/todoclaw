import { useRef } from 'react'
import type { RefObject } from 'react'
import type { Task } from '../../types/task'
import { daysUntil } from '../../lib/scoring'
import { useConfirm } from '../../components/use-confirm'
import { ViewToggle } from '../../components/ViewToggle'
import type { WorkView } from '../../components/tabs'
import { useElementSize } from '../../hooks/use-element-size'
import { boxClampBounds, clampPoint } from '../../hooks/use-free-drag'
import { GridCanvas } from './GridCanvas'
import { GridCard } from './GridCard'
import { GridAxes } from './GridAxes'
import { CARD_HALF_HEIGHT, CARD_HALF_WIDTH } from './grid-constants'
import { ClusterBubble } from '../clustering/ClusterBubble'
import { ClusterPopup } from '../clustering/ClusterPopup'
import { CLUSTER_BUBBLE_HALF } from '../clustering/cluster-constants'
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
    selectCluster,
    startPopupRowDrag,
    editingClusterRowId,
    startClusterRowEdit,
    stopClusterRowEdit,
    handleGridPointerDown,
    clusterDominant,
    clusterAccentColor,
    clusterNearestDue,
    urgencyGlowStyle,
  } = grid

  const confirm = useConfirm()

  // Live grid dimensions (react to the chat push-drawer + window resize). The edge clamp margins
  // are a pixel half-extent over these, so cards/bubbles near an edge pull inward and can't be
  // clipped by the canvas's `overflow-hidden` (item 17). Applied at RENDER time (screen coords
  // only — stored x/y and the clustering thresholds are untouched, so grouping is unchanged) so
  // even pre-existing edge cards and cluster bubbles are held inside at the current grid width.
  const gridSize = useElementSize(gridRef)
  const cardBounds = boxClampBounds(gridSize, CARD_HALF_WIDTH, CARD_HALF_HEIGHT)
  const bubbleBounds = boxClampBounds(gridSize, CLUSTER_BUBBLE_HALF, CLUSTER_BUBBLE_HALF)
  const reflowKey = gridSize.width + gridSize.height

  // The open bubble's positioned wrapper node — the portaled popup anchors to its live rect.
  const anchorRef = useRef<HTMLDivElement | null>(null)

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
  const renderGridCard = (task: Task & { x: number; y: number }) => {
    // Re-clamp the stored coords to the card's bounding box at the current grid width (screen
    // position only — task.x/task.y and clustering are unchanged).
    const p = clampPoint(task.x, task.y, cardBounds)
    return (
      <GridCard
        key={task.id}
        task={task}
        screenX={p.x}
        screenY={1 - p.y}
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
            updateMutate({
              id: task.id,
              patch: { recurring: { ...task.recurring, frequencyDays } },
            })
        }}
        onRemoveRecurring={() => updateMutate({ id: task.id, patch: { recurring: null } })}
      />
    )
  }

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
          ? 'fixed inset-0 z-50 flex flex-col items-center justify-center overflow-auto bg-bg pl-8 pr-4'
          : 'relative pb-6 pl-5'
      }
    >
      {/* The canvas is aspect-locked (1046/640), so height follows width. INLINE, the grid is
          DOMINANT by filling its (now wider, 1280px) column edge-to-edge; the chat push-drawer
          shrinks that column so the grid reflows smaller with it (B2). A tall grid may run past
          the fold on short windows (the Expand control gives a fit-to-height fullscreen view) —
          that's the trade for a big, column-filling grid. EXPANDED is the reverse: a height-driven
          max-width so the fullscreen canvas fits the viewport height. The 64px offset is the only
          chrome outside the canvas — the overlay `justify-center`s the canvas, so that budget
          splits into ~32px top / ~32px bottom margins, which comfortably clear the toggle that
          straddles the top edge (~13px above) and the urgency axis arrow just below (~18px). The
          1046/640 ratio is NEVER distorted (the clustering thresholds CX/CY depend on it). */}
      <div
        className="relative mx-auto w-full"
        style={expanded ? { maxWidth: 'calc((100vh - 64px) * 1046 / 640)' } : undefined}
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
            // Clamp the bubble by its own (wider) half-extent so it stays fully inside the canvas.
            const bp = clampPoint(dominant.x ?? 0.5, dominant.y ?? 0.5, bubbleBounds)
            return (
              <ClusterBubble
                key={dominant.id}
                group={group}
                accentColor={accentColor}
                screenX={bp.x}
                screenY={1 - bp.y}
                glow={urgencyGlowStyle(clusterMinD)}
                open={open}
                onToggle={() => selectCluster(open ? null : dominant.id)}
                // Register the bubble node under the dominant id (same key `memberToNodeKey` uses)
                // so the merge preview can flag this bubble when a drag would merge into it. The
                // open bubble also feeds `anchorRef` so the portaled popup can anchor to its rect.
                bubbleRef={(node) => {
                  registerCardNode(dominant.id, node)
                  if (open) anchorRef.current = node
                }}
              >
                {open && (
                  <ClusterPopup
                    group={group}
                    accentColor={accentColor}
                    anchorRef={anchorRef}
                    reflowKey={reflowKey}
                    timeZone={timeZone}
                    editingId={editingClusterRowId}
                    onStartEdit={(task) => startClusterRowEdit(task.id)}
                    onStopEdit={stopClusterRowEdit}
                    onRename={(task, text) => updateMutate({ id: task.id, patch: { text } })}
                    onDone={handleDone}
                    onDelete={handleDelete}
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
