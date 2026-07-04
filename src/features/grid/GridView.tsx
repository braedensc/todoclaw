import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { Task } from '../../types/task'
import { useSoftDeleteTask, useTasks, useUpdateTask } from '../tasks/use-tasks'
import { useMarkTaskDone } from '../done/use-history'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { recurringStatus } from '../../lib/recurring'
import { daysUntil } from '../../lib/scoring'
import { quadrantMeta } from '../../lib/quadrants'
import { urgencyGlowStyle } from '../../lib/visual-urgency'
import {
  clusterAccentColor,
  clusterDominant,
  clusterNearestDue,
  computeClusters,
  CX,
  CY,
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

  // DOM nodes for currently-rendered placed cards, keyed by task id. During a drag we mutate
  // the dragged card's `left`/`top` style directly on this node (bypassing React) so 60fps
  // pointermove doesn't pay a full-tree re-render each frame. React state is only touched on
  // pointerdown/pointerup; on the next real render React re-applies the committed style from
  // `task.x`/`task.y`, so nothing can drift out of sync with what we mutated imperatively.
  const cardNodesRef = useRef(new Map<string, HTMLDivElement>())
  const registerCardNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) cardNodesRef.current.set(id, node)
    else cardNodesRef.current.delete(id)
  }, [])

  // Once a tray card / cluster-popup row is "materialized" (flipped to a placed card so a real
  // GridCard mounts under the pointer), hold its id here so the move loop commits that flip
  // exactly once instead of on every frame while the mount is in flight.
  const materializedRef = useRef<string | null>(null)
  // The card currently flagged with `data-merge-target` (the merge-preview under-card), so we
  // can clear it on the next frame / on drop. A plain DOM attribute, never React state, to keep
  // the per-frame model fully imperative.
  const mergeTargetRef = useRef<string | null>(null)
  // Live mirror of `placedTasks` for the per-frame handlers (kept off the callback deps so the
  // handlers stay stable yet always read the latest committed positions).
  const placedTasksRef = useRef<Array<Task & { x: number; y: number }>>([])

  // Flag the nearest placed card within the cluster thresholds (CX/CY) as the merge target, so
  // CSS can grow + darken it as a preview of the merge-on-drop (fix 20). Cards that are part of
  // a cluster render as a bubble (no individual node), so they are naturally skipped.
  const updateMergeTarget = useCallback((draggedId: string, point: NormalizedPoint) => {
    let nearestId: string | null = null
    let best = Infinity
    for (const t of placedTasksRef.current) {
      if (t.id === draggedId) continue
      if (!cardNodesRef.current.has(t.id)) continue
      const dx = Math.abs(t.x - point.x)
      const dy = Math.abs(t.y - point.y)
      if (dx < CX && dy < CY) {
        const dist = dx * dx + dy * dy
        if (dist < best) {
          best = dist
          nearestId = t.id
        }
      }
    }
    if (nearestId === mergeTargetRef.current) return
    if (mergeTargetRef.current) {
      cardNodesRef.current.get(mergeTargetRef.current)?.removeAttribute('data-merge-target')
    }
    if (nearestId) cardNodesRef.current.get(nearestId)?.setAttribute('data-merge-target', '')
    mergeTargetRef.current = nearestId
  }, [])

  const clearMergeTarget = useCallback(() => {
    if (mergeTargetRef.current) {
      cardNodesRef.current.get(mergeTargetRef.current)?.removeAttribute('data-merge-target')
      mergeTargetRef.current = null
    }
  }, [])

  // Per-frame paint for a card whose node is already mounted: move it (direct DOM), recolor its
  // top border by quadrant as it crosses an axis (fix 11 — recurring cards keep their RC_COLOR),
  // and refresh the merge-preview target (fix 20).
  const paintDragFrame = useCallback(
    (id: string, point: NormalizedPoint) => {
      const node = cardNodesRef.current.get(id)
      if (!node) return
      node.style.left = `${point.x * 100}%`
      node.style.top = `${(1 - point.y) * 100}%`
      const dragged = placedTasksRef.current.find((t) => t.id === id)
      if (dragged && !dragged.recurring) {
        node.style.borderTopColor = quadrantMeta(point.x, point.y).color
      }
      updateMergeTarget(id, point)
    },
    [updateMergeTarget],
  )

  // Shared move handler for all three drags (reposition, tray → grid, popup drag-out). If the
  // dragged task isn't on the grid yet (a still-staged tray card), flip it to placed ONCE so a
  // real GridCard mounts under the pointer (fix 12) — subsequent frames then move that node
  // directly. A card that already has a node (reposition, or an already-materialized one) paints
  // straight away.
  const updateMutate = updateTask.mutate
  const handleDragMove = useCallback(
    (id: string, point: NormalizedPoint) => {
      if (materializedRef.current !== id && !cardNodesRef.current.has(id)) {
        materializedRef.current = id
        updateMutate({ id, patch: { x: point.x, y: point.y, staged: false } })
        return
      }
      paintDragFrame(id, point)
    },
    [updateMutate, paintDragFrame],
  )

  // Cleanup shared by every drop/cancel: clear the merge preview and reset the materialize latch.
  const endDrag = useCallback(() => {
    clearMergeTarget()
    materializedRef.current = null
  }, [clearMergeTarget])

  // Tap-to-place selection (mobile / touch): the tray task awaiting a grid tap.
  const [placingId, setPlacingId] = useState<string | null>(null)

  // The open cluster popup, keyed by its dominant task id (the bubble's data-task-id). Closed
  // by clicking the grid background, dragging a row out, or marking a recurring task done.
  const [openClusterId, setOpenClusterId] = useState<string | null>(null)

  const placedTasks = useMemo(
    () => tasks.filter((t): t is Task & { x: number; y: number } => isPlaced(t, doneToday ?? {})),
    [tasks, doneToday],
  )
  // Keep the per-frame drag handlers reading fresh committed positions without re-subscribing.
  // Updated in an effect (not during render) so the ref stays in step with each committed render.
  useEffect(() => {
    placedTasksRef.current = placedTasks
  })
  const stagedTasks = useMemo(() => tasks.filter((t) => t.staged), [tasks])

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
      // No collision resolution on drag — overlap is fine (clustering absorbs it).
      updateMutate({ id, patch: { x: point.x, y: point.y } })
      endDrag()
    },
    [updateMutate, endDrag],
  )

  const reposition = useFreeDrag({
    surfaceRef: gridRef,
    onDrop: handleRepositionDrop,
    onMove: handleDragMove,
  })

  // --- Tray → grid drag (desktop) --------------------------------------------------------
  const handleTrayDrop = useCallback(
    (id: string, point: NormalizedPoint) => {
      updateMutate({ id, patch: { x: point.x, y: point.y, staged: false } })
      endDrag()
    },
    [updateMutate, endDrag],
  )
  const trayDrag = useFreeDrag({
    surfaceRef: gridRef,
    onDrop: handleTrayDrop,
    onMove: handleDragMove,
  })

  // --- Popup row → grid drag-out ---------------------------------------------------------
  // Pulls a task out of a cluster: drop commits its new x/y (and clears any staged flag) so it
  // separates from the seed. The popup is closed + the card separated on pointer-down (below).
  const handlePopupDrop = useCallback(
    (id: string, point: NormalizedPoint) => {
      updateMutate({ id, patch: { x: point.x, y: point.y, staged: false } })
      endDrag()
    },
    [updateMutate, endDrag],
  )
  const popupDrag = useFreeDrag({
    surfaceRef: gridRef,
    onDrop: handlePopupDrop,
    onMove: handleDragMove,
  })
  const startPopupRowDrag = useCallback(
    (task: Task) => (event: PointerEvent) => {
      // Dragging a row out implicitly closes the popup; the card then tracks the pointer.
      setOpenClusterId(null)
      // Separate the card from its cluster IMMEDIATELY (fix 16): commit the pointer's x/y so a
      // real, standalone GridCard mounts under the pointer before the move loop runs — otherwise
      // the card is invisible (still folded into the bubble) until drop. Mirrors EisenClaw
      // (planner.html:624), which commits x/y on the row's pointer-down. Pre-latch materialize so
      // the first move paints the mounted node instead of re-committing.
      const rect = gridRef.current?.getBoundingClientRect()
      if (rect) {
        const point = toNormalized(rect, event.clientX, event.clientY)
        materializedRef.current = task.id
        updateMutate({ id: task.id, patch: { x: point.x, y: point.y, staged: false } })
      }
      popupDrag.startDrag(task.id)(event)
    },
    [popupDrag, updateMutate],
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

  // The id currently being dragged (reposition, tray → grid, or popup drag-out) — suppresses its
  // transition and lifts it while it moves.
  const draggingId = reposition.draggingId ?? trayDrag.draggingId ?? popupDrag.draggingId

  // Cluster over everything EXCEPT the dragged card (mirrors EisenClaw's `staticCards`,
  // planner.html:560). The dragged card renders standalone below so its DOM node stays mounted
  // for direct-DOM movement and it can never fold into a bubble mid-drag.
  const clusters = useMemo(
    () => computeClusters(placedTasks.filter((t) => t.id !== draggingId)),
    [placedTasks, draggingId],
  )
  const draggedTask = draggingId ? placedTasks.find((t) => t.id === draggingId) : undefined

  // One placed card. Shared by the singleton-cluster render and the standalone dragged-card
  // render so both stay byte-for-byte identical (same handlers, same node registration).
  const renderGridCard = (task: Task & { x: number; y: number }) => (
    <GridCard
      key={task.id}
      task={task}
      screenX={task.x}
      screenY={1 - task.y}
      daysUntilDue={daysUntil(task.due, { timeZone })}
      dragging={draggingId === task.id}
      cardRef={(node) => registerCardNode(task.id, node)}
      onPointerDown={reposition.startDrag(task.id)}
      onRename={(text) => updateMutate({ id: task.id, patch: { text } })}
      onDelete={() => softDeleteMutate(task.id)}
      onBackToTray={() => updateMutate({ id: task.id, patch: { staged: true } })}
      onDone={() => handleDone(task)}
    />
  )

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
            // A singleton group renders as a normal, draggable card.
            if (group.length === 1) {
              // Non-null by construction (placedTasks filter); render via the shared helper.
              return renderGridCard(group[0] as Task & { x: number; y: number })
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

          {/* The dragged card, rendered standalone and on top so it always has a live DOM node to
              move (never absorbed into a bubble). It's a tray card once it materializes, a card
              pulled out of a cluster, or a repositioned singleton — all via the same helper. */}
          {draggedTask && renderGridCard(draggedTask)}
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
