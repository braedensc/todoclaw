import { useCallback, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { Task } from '../../types/task'
import { useSoftDeleteTask, useTasks, useUpdateTask } from '../tasks/use-tasks'
import { useMarkTaskDone } from '../done/use-history'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { recurringStatus } from '../../lib/recurring'
import { daysUntil } from '../../lib/scoring'
import { urgencyGlowStyle } from '../../lib/visual-urgency'
import {
  clusterAccentColor,
  clusterDominant,
  clusterNearestDue,
  computeClusters,
} from '../../lib/clustering'
import { useFreeDrag, toNormalized, type NormalizedPoint } from '../../hooks/use-free-drag'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { GridCanvas } from './GridCanvas'
import { GridCard } from './GridCard'
import { StagingTray } from './StagingTray'
import { ClusterBubble } from '../clustering/ClusterBubble'
import { ClusterPopup } from '../clustering/ClusterPopup'

/**
 * Which tasks render on the grid: active (not soft-deleted — already excluded by useTasks),
 * non-staged, not done today, and — for recurring tasks — only when not "ok" (ok-recurring
 * tasks are hidden to keep the grid uncluttered between cycles). x/y must be non-null.
 */
function isPlaced(
  task: Task,
  doneToday: Record<string, boolean>,
): task is Task & { x: number; y: number } {
  if (task.staged) return false
  if (task.x == null || task.y == null) return false
  if (doneToday[task.id]) return false
  const rc = recurringStatus(task.recurring)
  if (rc && rc.code === 'ok') return false
  return true
}

export function GridView() {
  const gridRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()

  const { data: tasks = [] } = useTasks()
  const timeZone = useTimeZone()
  const { data: daily } = useDailyState(timeZone)
  const doneToday = daily?.done

  const updateTask = useUpdateTask()
  const softDelete = useSoftDeleteTask()
  const markDone = useMarkTaskDone()

  // Live "ghost" position for the card under drag, so it tracks the pointer before the write
  // lands. Keyed by id; cleared on drop.
  const [ghost, setGhost] = useState<{ id: string; point: NormalizedPoint } | null>(null)

  // Tap-to-place selection (mobile / touch): the tray task awaiting a grid tap.
  const [placingId, setPlacingId] = useState<string | null>(null)

  // The open cluster popup, keyed by its dominant task id (the bubble's data-task-id). Closed
  // by clicking the grid background, dragging a row out, or marking a recurring task done.
  const [openClusterId, setOpenClusterId] = useState<string | null>(null)

  const placedTasks = useMemo(
    () => tasks.filter((t): t is Task & { x: number; y: number } => isPlaced(t, doneToday ?? {})),
    [tasks, doneToday],
  )
  const stagedTasks = useMemo(() => tasks.filter((t) => t.staged), [tasks])

  // Seed-based, non-transitive grouping (math lives in lib/clustering). A group of 1 renders as
  // a normal card; a group of >1 collapses into a bubble + expandable popup.
  const clusters = useMemo(() => computeClusters(placedTasks), [placedTasks])

  const updateMutate = updateTask.mutate
  const softDeleteMutate = softDelete.mutate
  const markDoneMutate = markDone.mutate

  // --- Mark done (shared by grid cards + popup rows) -------------------------------------
  // Normal task: write history + today's daily_state (it leaves the grid). Recurring task:
  // reset the cycle (lastDoneAt=now, doneCount+1) WITHOUT touching history/daily_state — it
  // re-evaluates to "ok" and is hidden until the next cycle. Closes any open popup.
  const handleDone = useCallback(
    (task: Task) => {
      setOpenClusterId(null)
      if (task.recurring) {
        updateMutate({
          id: task.id,
          patch: {
            recurring: {
              ...task.recurring,
              lastDoneAt: new Date().toISOString(),
              doneCount: (task.recurring.doneCount ?? 0) + 1,
            },
          },
        })
      } else {
        markDoneMutate({ taskId: task.id, text: task.text, bucket: task.bucket, timeZone })
      }
    },
    [markDoneMutate, updateMutate, timeZone],
  )

  // --- Reposition (grid card) drag -------------------------------------------------------
  const handleRepositionDrop = useCallback(
    (id: string, point: NormalizedPoint) => {
      setGhost(null)
      // No collision resolution on drag — overlap is fine (clustering absorbs it).
      updateMutate({ id, patch: { x: point.x, y: point.y } })
    },
    [updateMutate],
  )
  const handleMoveGhost = useCallback((id: string, point: NormalizedPoint) => {
    setGhost({ id, point })
  }, [])

  const reposition = useFreeDrag({
    surfaceRef: gridRef,
    onDrop: handleRepositionDrop,
    onMove: handleMoveGhost,
  })

  // --- Tray → grid drag (desktop) --------------------------------------------------------
  const handleTrayDrop = useCallback(
    (id: string, point: NormalizedPoint) => {
      setGhost(null)
      updateMutate({ id, patch: { x: point.x, y: point.y, staged: false } })
    },
    [updateMutate],
  )
  const trayDrag = useFreeDrag({
    surfaceRef: gridRef,
    onDrop: handleTrayDrop,
    onMove: handleMoveGhost,
  })

  // --- Popup row → grid drag-out ---------------------------------------------------------
  // Pulls a task out of a cluster: drop commits its new x/y (and clears any staged flag) so it
  // separates from the seed. The popup is closed on pointer-down (handled by startDrag below).
  const handlePopupDrop = useCallback(
    (id: string, point: NormalizedPoint) => {
      setGhost(null)
      updateMutate({ id, patch: { x: point.x, y: point.y, staged: false } })
    },
    [updateMutate],
  )
  const popupDrag = useFreeDrag({
    surfaceRef: gridRef,
    onDrop: handlePopupDrop,
    onMove: handleMoveGhost,
  })
  const startPopupRowDrag = useCallback(
    (task: Task) => (event: PointerEvent) => {
      // Dragging a row out implicitly closes the popup; the card then tracks the pointer.
      setOpenClusterId(null)
      popupDrag.startDrag(task.id)(event)
    },
    [popupDrag],
  )

  // --- Tap-to-place (mobile / touch) + background click (close popup) ---------------------
  const handleGridPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // A click on empty canvas always dismisses an open cluster popup.
      setOpenClusterId(null)
      if (!isMobile || !placingId) return
      const rect = gridRef.current?.getBoundingClientRect()
      if (!rect) return
      const point = toNormalized(rect, event.clientX, event.clientY)
      updateMutate({ id: placingId, patch: { x: point.x, y: point.y, staged: false } })
      setPlacingId(null)
    },
    [isMobile, placingId, updateMutate],
  )

  const togglePlacing = useCallback((id: string) => {
    setPlacingId((cur) => (cur === id ? null : id))
  }, [])

  // The id currently being repositioned/dragged from the tray (suppresses its transition).
  const draggingId = reposition.draggingId ?? trayDrag.draggingId

  return (
    <section aria-label="Grid" className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <GridCanvas surfaceRef={gridRef} onBackgroundPointerDown={handleGridPointerDown}>
          {placedTasks.length === 0 && (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted">
              No tasks placed — drag one from the tray.
            </p>
          )}

          {clusters.map((group) => {
            // A singleton group renders exactly as before — a normal, draggable card.
            if (group.length === 1) {
              const task = group[0]!
              const live = ghost?.id === task.id ? ghost.point : { x: task.x!, y: task.y! }
              // Data-space → screen: x left→right, y inverted (high importance = top).
              return (
                <GridCard
                  key={task.id}
                  task={task}
                  screenX={live.x}
                  screenY={1 - live.y}
                  daysUntilDue={daysUntil(task.due, { timeZone })}
                  dragging={draggingId === task.id}
                  onPointerDown={reposition.startDrag(task.id)}
                  onRename={(text) => updateMutate({ id: task.id, patch: { text } })}
                  onDelete={() => softDeleteMutate(task.id)}
                  onBackToTray={() => updateMutate({ id: task.id, patch: { staged: true } })}
                  onDone={() => handleDone(task)}
                />
              )
            }

            // Overlapping group → a single bubble at the dominant task's coords, with the
            // expandable popup. Accent/dominant come from lib/clustering (recurring-aware).
            const dominant = clusterDominant(group, { timeZone })
            const accentColor = clusterAccentColor(group, { timeZone })
            // The bubble glows for its most-urgent member: the nearest due date among the
            // group's non-recurring tasks (recurring tasks carry their own status).
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

      <div className="lg:w-64 lg:flex-shrink-0">
        <StagingTray
          tasks={stagedTasks}
          tapToPlace={isMobile}
          placingId={placingId}
          onCardPointerDown={(id) => trayDrag.startDrag(id)}
          onSelectForPlacement={togglePlacing}
        />
      </div>
    </section>
  )
}
