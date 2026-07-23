import { useCallback, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Task } from '../../types/task'
import { daysUntil } from '../../lib/scoring'
import { minutesUntilDueTime } from '../../lib/dates'
import { clusterStaleness, staleRingStyle, urgencyTier } from '../../lib/visual-urgency'
import { useNow } from '../../hooks/use-now'
import { useTaskReminders, useTaskReminderWrites } from '../reminders/use-task-reminders'
import { useSetDueWithDefaultReminder } from '../schedule/use-set-due'
import { useConfirm } from '../../components/use-confirm'
import { ViewToggle } from '../../components/ViewToggle'
import type { WorkView } from '../../components/tabs'
import { useElementSize } from '../../hooks/use-element-size'
import { boxClampBounds, clampPoint } from '../../hooks/use-free-drag'
import { GridCanvas } from './GridCanvas'
import { GridCard } from './GridCard'
import { TouchCardPopover } from './TouchCardPopover'
import { GridAxes } from './GridAxes'
import { GridLegend } from './GridLegend'
import { PawPrintShape } from './PawTrail'
import { TodoClawPeek } from '../../components/TodoClawPeek'
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
  /** True while the grid is shown alone, fullscreen — the header "Grid-only view" mode. */
  gridOnly: boolean
  /** Leave grid-only mode and return to the normal shell (also wired to Esc in AppShell). */
  onExitGridOnly: () => void
  /**
   * Open the example-day scene (DemoScene) from the empty-grid state — the moment a confused new
   * user is most likely staring at. Absent inside the demo scene itself (its board is never empty).
   */
  onSeeExample?: () => void
}

/**
 * The dominant grid surface: the free-canvas GridCanvas with its placed cards / cluster bubbles,
 * the embedded Grid⇄List toggle notched into its top border, and the long axis arrows drawn just
 * outside the edges (B8, item 4). All the drag/placement state comes from the shared `useGrid` api;
 * this component is the canvas render.
 *
 * In `gridOnly` mode it becomes a fullscreen overlay showing ONLY the grid (no toggle — that mode
 * has no list): the entry point is the header "Grid-only view" pill, and the sole exits are the
 * labelled ✕ pill pinned to the viewport corner and Esc. Inline (the default), it renders the
 * normal main-page grid with the Grid⇄List toggle notched into its top border.
 */
export function GridSurface({
  grid,
  gridRef,
  view,
  onSelectView,
  gridOnly,
  onExitGridOnly,
  onSeeExample,
}: GridSurfaceProps) {
  const {
    timeZone,
    placedTasks,
    dormantPlaced,
    clusters,
    draggedTask,
    draggingId,
    registerCardNode,
    getCardNode,
    startReposition,
    updateMutate,
    softDeleteMutate,
    handleDone,
    tappedCardId,
    clearCardTap,
    openClusterId,
    selectCluster,
    startPopupRowDrag,
    editingClusterRowId,
    stopClusterRowEdit,
    handleGridPointerDown,
    clusterDominant,
    clusterAccentColor,
    clusterNearestDue,
    urgencyGlowStyle,
  } = grid

  const confirm = useConfirm()

  // One shared clock for every card's countdown / timed-overdue tier (30s tick — see useNow).
  const now = useNow()

  // Reminders for the whole grid in one query; each card's ⋯ menu reads/writes its own via these.
  // A recurring card's reminders lead each occurrence — same offset picker as a one-off.
  const { data: reminders } = useTaskReminders()
  const reminderWrites = useTaskReminderWrites()

  // Due writes (card ⋯ menu + cluster rows) go through the shared setDue so a task gaining its
  // first due time picks up the user's default reminder, like every other schedule surface.
  const setDue = useSetDueWithDefaultReminder()

  // Set/clear the ongoing-project flag (shared by a card's ⋯ menu and a cluster row). Setting it
  // true also clears any recurring schedule, keeping the two types exclusive in a single mutation.
  const setOngoing = (task: Task, on: boolean) =>
    updateMutate({
      id: task.id,
      patch: on ? { ongoing: true, recurring: null } : { ongoing: false },
    })

  // Pause (future start date) / resume (null) — shared by a card's ⋯ menu and a cluster row. A
  // paused card leaves the grid on the next render; the list's Paused strip is where it lives.
  const setStartDate = (task: Task, startDate: string | null) =>
    updateMutate({ id: task.id, patch: { start_date: startDate } })

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

  // Completion moment (style mix grab-bag): marking a card done stamps one fading paw print at
  // its stored x/y while the card leaves the grid — a 900ms flourish, then the element unmounts
  // (the timeout runs past the CSS animation so it never cuts the fade short). Skipped when the
  // user asks for reduced motion (the .tc-paw-stamp CSS also hides it, belt-and-braces) and in
  // jsdom (no matchMedia). Wraps handleDone for both the standalone card and the cluster rows.
  const [stamps, setStamps] = useState<Array<{ key: number; x: number; y: number }>>([])
  const stampSeq = useRef(0)
  const doneWithStamp = (task: Task) => {
    const reduce =
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!reduce && task.x != null && task.y != null) {
      const key = ++stampSeq.current
      const { x, y } = task
      setStamps((s) => [...s, { key, x, y }])
      setTimeout(() => setStamps((s) => s.filter((st) => st.key !== key)), 1000)
    }
    handleDone(task)
  }

  // Delete now confirms first (was a silent soft-delete), mirroring the List/cluster surfaces (B9).
  // The app-themed useConfirm gate names the task so an accidental click can't quietly remove it.
  const handleDelete = async (task: Task) => {
    if (
      await confirm({ title: `Delete “${task.text}”?`, message: 'This removes it from your grid.' })
    )
      softDeleteMutate(task.id)
  }

  // iPad hybrid (workshop PR 4): on coarse-pointer desktop, a TAP on a card (freed up by the
  // hold-to-lift reposition — use-grid) opens the touch actions popover anchored to that card.
  // Resolved against BOTH passes — active placedTasks AND dormant cards (which are now draggable +
  // tappable too; the popover has its own paused mode: Schedule/Delete, no Done). A task that
  // leaves either set — completed or deleted elsewhere — drops out here, so tappedTask goes null
  // and the popover unmounts cleanly.
  const tappedTask = tappedCardId
    ? (placedTasks.find((t) => t.id === tappedCardId) ??
      dormantPlaced.find((t) => t.id === tappedCardId) ??
      null)
    : null
  const tappedPaused = tappedTask != null && dormantPlaced.some((t) => t.id === tappedTask.id)
  // A STABLE getter the popover measures against — not a node prop (would trip
  // set-state-in-effect) and not a render-written ref (trips react-compiler's no-refs-in-render).
  // getCardNode is a stable useCallback; tappedCardId is fixed for a popover instance (keyed).
  const getPopoverAnchor = useCallback(
    () => (tappedCardId ? getCardNode(tappedCardId) : null),
    [getCardNode, tappedCardId],
  )

  // One placed card. Shared by the singleton-cluster render, the standalone dragged-card render,
  // and the dormant "set aside" pass so all three stay byte-for-byte identical (same handlers,
  // same schedule wiring). recurring/rename reuse the one generic updateMutate({ id, patch }); a
  // due write goes through setDue and sets `due`/`due_time` ONLY — it never touches x/y, so setting
  // a due date on a manually-placed card can't move it.
  //
  // `paused` renders the dormant lane's SLATE DRESS (ring / ⏸ chip / 💤 flag / dim) inside GridCard,
  // but the card stays fully interactive: same reposition drag + node registration + tap→popover as
  // an active card (dragging a dormant card just moves WHERE it will land on wake — the drop writes
  // x/y only, never start_date, so it stays dormant). Every write handler stays wired so the ⋯
  // SchedulePanel can Resume it.
  const renderGridCard = (task: Task & { x: number; y: number }, paused = false) => {
    // Re-clamp the stored coords to the card's bounding box at the current grid width (screen
    // position only — task.x/task.y and clustering are unchanged).
    const p = clampPoint(task.x, task.y, cardBounds)
    return (
      <GridCard
        key={task.id}
        task={task}
        paused={paused}
        screenX={p.x}
        screenY={1 - p.y}
        timeZone={timeZone}
        daysUntilDue={daysUntil(task.due, { timeZone })}
        minutesUntilDue={minutesUntilDueTime(task.due, task.due_time, timeZone, now)}
        dragging={draggingId === task.id}
        cardRef={(node) => registerCardNode(task.id, node)}
        onPointerDown={startReposition(task.id)}
        onRename={(text) => updateMutate({ id: task.id, patch: { text } })}
        onDelete={() => handleDelete(task)}
        onDone={() => doneWithStamp(task)}
        onSetDue={(due, due_time) => setDue(task, due, due_time)}
        reminderOffsets={reminders?.get(task.id) ?? []}
        onToggleReminder={(minutes) =>
          reminderWrites.toggle(task.id, minutes, reminders?.get(task.id) ?? [])
        }
        onClearReminders={() => reminderWrites.clear(task.id)}
        onSetOngoing={(on) => setOngoing(task, on)}
        onSetStartDate={(startDate) => setStartDate(task, startDate)}
        onSetRecurring={(frequencyDays) =>
          updateMutate({
            id: task.id,
            patch: { recurring: { frequencyDays, lastDoneAt: null, doneCount: 0 }, ongoing: false },
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
    // Outer wrapper reserves the outside gutters (pl / pb) the axis arrows live in. In grid-only
    // mode it becomes a fixed fullscreen overlay; the canvas keeps its aspect ratio but grows to
    // fill the viewport height (max-width derived from the available height).
    <div
      data-tour="grid"
      className={
        gridOnly
          ? 'fixed inset-0 z-50 flex flex-col items-center justify-center overflow-auto bg-bg pl-8 pr-4'
          : 'relative pb-6 pl-5'
      }
    >
      {/* Grid-only exit — the fullscreen overlay covers the header (and its entry pill), so this
          labelled ✕ pill pinned to the viewport corner, plus Esc, are the ways back. Tinted in the
          same brand green as the entry pill (soft fill so it stays legible over the grid cards). */}
      {gridOnly && (
        <button
          type="button"
          onClick={onExitGridOnly}
          aria-label="Exit grid-only view"
          title="Exit grid-only view (Esc)"
          className="absolute right-4 top-4 z-[60] flex items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary shadow-sm hover:bg-primary/20"
        >
          <span aria-hidden>✕</span> Exit grid-only
        </button>
      )}

      {/* The canvas is aspect-locked (1046/640), so height follows width. INLINE, the grid is
          DOMINANT by filling its (now wider, 1280px) column edge-to-edge; the chat push-drawer
          shrinks that column so the grid reflows smaller with it (B2). A tall grid may run past
          the fold on short windows (the header "Grid-only view" pill gives a fit-to-height
          fullscreen view) — that's the trade for a big, column-filling grid. GRID-ONLY is the
          reverse: a height-driven max-width so the fullscreen canvas fits the viewport height. The
          64px offset is the only chrome outside the canvas — the overlay `justify-center`s the
          canvas, so that budget splits into ~32px top / ~32px bottom margins, which comfortably
          clear the urgency axis arrow just below the top edge (~18px). The 1046/640 ratio is NEVER
          distorted (the clustering thresholds CX/CY depend on it). */}
      <div
        className="relative mx-auto w-full"
        style={gridOnly ? { maxWidth: 'calc((100vh - 64px) * 1046 / 640)' } : undefined}
      >
        {/* Embedded Grid⇄List toggle — the normal main-page control, notched into the canvas's top
            border line. Hidden in grid-only mode (that mode shows the grid alone, no list). */}
        {!gridOnly && (
          <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
            <ViewToggle view={view} onSelect={onSelectView} />
          </div>
        )}

        <GridAxes />

        {/* The paw trail's owner: TodoClaw peeking over the canvas's top edge, over the Do Now
            quadrant just left of its corner label. He lives OUTSIDE the canvas (which clips
            overflow) so his head rises above the border; the -top offset puts his chin-clip line
            (42.2/64 of his 40px height ≈ 26px) exactly on the border, and pointer-events-none
            keeps him out of every drag. Blinks on the offset clock so he and the wordmark pup
            never blink in sync. */}
        <TodoClawPeek
          ledge={false}
          blinkClassName="tc-eye-blink-alt"
          className="pointer-events-none absolute right-[84px] top-[-26px] z-10 h-10 w-10 drop-shadow-sm"
        />

        <GridCanvas surfaceRef={gridRef} onBackgroundPointerDown={handleGridPointerDown}>
          {placedTasks.length === 0 && dormantPlaced.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
              <p>No tasks placed — add one above and drag it here.</p>
              {onSeeExample && (
                <button
                  type="button"
                  onClick={onSeeExample}
                  className="pointer-events-auto rounded-full border border-border-strong bg-panel px-3.5 py-1.5 text-[13px] font-medium text-ink shadow-sm transition-colors hover:border-ink"
                >
                  <span aria-hidden>👀</span> See an example board
                </button>
              )}
            </div>
          )}

          {/* Dormant (paused / future start_date) cards — their OWN pass, rendered FIRST so they
              paint BEHIND the active clustered cards (all cards are absolutely positioned; DOM
              order is paint order). They stay out of `groups`/clustering entirely (a paused card
              can never fold into an active bubble), but are draggable/tappable like any card — the
              slate ⏸ dress just marks WHERE they will land when they wake. */}
          {dormantPlaced.map((task) => renderGridCard(task, true))}

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
                // Bubbles stay date-granular (nearest due day → tier): minute-level countdown on
                // an aggregate bubble would imply a precision the group doesn't have. Stale
                // members are excluded from the nearest-due (clusterNearestDue), so a bubble of
                // only ignored tasks wears the cool ring below, not a hot pulse.
                glow={urgencyGlowStyle(urgencyTier(clusterMinD, null))}
                // The cool-blue stale ring of the cluster's deepest-stale folded card.
                staleRing={staleRingStyle(clusterStaleness(group, { timeZone }))}
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
                    onStopEdit={stopClusterRowEdit}
                    onRename={(task, text) => updateMutate({ id: task.id, patch: { text } })}
                    onDone={doneWithStamp}
                    onDelete={handleDelete}
                    onRowPointerDown={startPopupRowDrag}
                    // Row ⋯ schedule menu — the SAME write wiring renderGridCard gives a card's
                    // ⋯ (a due write never touches x/y; Daily/Weekly preserve recurring history).
                    onSetDue={(task, due, due_time) => setDue(task, due, due_time)}
                    onSetRecurring={(task, frequencyDays) =>
                      updateMutate({
                        id: task.id,
                        patch: {
                          recurring: { frequencyDays, lastDoneAt: null, doneCount: 0 },
                          ongoing: false,
                        },
                      })
                    }
                    onSetFrequency={(task, frequencyDays) => {
                      if (task.recurring)
                        updateMutate({
                          id: task.id,
                          patch: { recurring: { ...task.recurring, frequencyDays } },
                        })
                    }}
                    onRemoveRecurring={(task) =>
                      updateMutate({ id: task.id, patch: { recurring: null } })
                    }
                    onSetOngoing={setOngoing}
                    onSetStartDate={setStartDate}
                    reminderOffsetsFor={(task) => reminders?.get(task.id) ?? []}
                    onToggleReminder={(task, minutes) =>
                      reminderWrites.toggle(task.id, minutes, reminders?.get(task.id) ?? [])
                    }
                    onClearReminders={(task) => reminderWrites.clear(task.id)}
                  />
                )}
              </ClusterBubble>
            )
          })}

          {/* Transient done stamps — see doneWithStamp above. Rendered last so a print blooms
              over neighboring cards, never under them. */}
          {stamps.map((s) => (
            <svg
              key={s.key}
              aria-hidden
              viewBox="0 0 100 100"
              className="tc-paw-stamp pointer-events-none absolute h-9 w-9"
              style={{ left: `${s.x * 100}%`, top: `${(1 - s.y) * 100}%`, zIndex: 25 }}
            >
              <PawPrintShape />
            </svg>
          ))}
        </GridCanvas>
      </div>

      {/* iPad hybrid touch actions (portaled, anchored to the tapped card; keyed by task id so
          rename draft / schedule disclosure reset per task — the TouchTaskSheet precedent). */}
      {tappedTask && (
        <TouchCardPopover
          key={tappedTask.id}
          task={tappedTask}
          paused={tappedPaused}
          getAnchor={getPopoverAnchor}
          reflowKey={reflowKey}
          daysUntilDue={daysUntil(tappedTask.due, { timeZone })}
          minutesUntilDue={minutesUntilDueTime(tappedTask.due, tappedTask.due_time, timeZone, now)}
          timeZone={timeZone}
          reminderOffsets={reminders?.get(tappedTask.id) ?? []}
          onClose={clearCardTap}
          onDone={() => {
            doneWithStamp(tappedTask)
            clearCardTap()
          }}
          onDelete={() => {
            void handleDelete(tappedTask)
            clearCardTap()
          }}
          onRename={(text) => updateMutate({ id: tappedTask.id, patch: { text } })}
          onSetDue={(due, dueTime) => setDue(tappedTask, due, dueTime)}
          onSetRecurring={(frequencyDays) =>
            updateMutate({
              id: tappedTask.id,
              patch: {
                recurring: { frequencyDays, lastDoneAt: null, doneCount: 0 },
                ongoing: false,
              },
            })
          }
          onSetFrequency={(frequencyDays) => {
            if (tappedTask.recurring)
              updateMutate({
                id: tappedTask.id,
                patch: { recurring: { ...tappedTask.recurring, frequencyDays } },
              })
          }}
          onRemoveRecurring={() => updateMutate({ id: tappedTask.id, patch: { recurring: null } })}
          onSetOngoing={(on) => setOngoing(tappedTask, on)}
          onSetStartDate={(startDate) => setStartDate(tappedTask, startDate)}
          onToggleReminder={(minutes) =>
            reminderWrites.toggle(tappedTask.id, minutes, reminders?.get(tappedTask.id) ?? [])
          }
          onClearReminders={() => reminderWrites.clear(tappedTask.id)}
        />
      )}

      {/* Urgency-ladder legend — below the frame, clear of the URGENCY axis arrow that lives in
          the bottom gutter (absolute at the frame's bottom edge; mt-7 steps past it). */}
      <GridLegend />
    </div>
  )
}
