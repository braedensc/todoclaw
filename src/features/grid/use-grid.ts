import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'
import type { Task } from '../../types/task'
import { useSoftDeleteTask, useTasks, useUpdateTask } from '../tasks/use-tasks'
import { useMarkTaskDone } from '../done/use-history'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { recurringDoneToday, recurringStatus } from '../../lib/recurring'
import { isDormant } from '../../lib/start-date'
import { quadrantMeta } from '../../lib/quadrants'
import { urgencyGlowStyle } from '../../lib/visual-urgency'
import {
  clusterAccentColor,
  clusterDominant,
  clusterNearestDue,
  computeClusters,
  mergePreviewIds,
} from '../../lib/clustering'
import {
  useFreeDrag,
  toNormalized,
  boxClampBounds,
  type NormalizedPoint,
  type SurfaceRect,
  type ClampBounds,
} from '../../hooks/use-free-drag'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { CARD_HALF_HEIGHT, CARD_HALF_WIDTH } from './grid-constants'

/**
 * Which tasks render on the grid: active (not soft-deleted — already excluded by useTasks),
 * non-staged, not completed, and — for recurring tasks — hidden when done today OR "ok" (both
 * keep the grid uncluttered between cycles). x/y must be non-null.
 *
 * A one-off completion is PERMANENT via task.completed_at, so a completed task stays off the
 * grid across days. `doneToday` (today's daily_state.done map) is kept as a belt-and-suspenders
 * hide for the same-day window before the tasks query refetches with completed_at set.
 *
 * A RECURRING task never sets completed_at (it resets recurring.lastDoneAt instead). Hiding it
 * only at status "ok" (daysLeft > 5) meant a short-cadence chore (≤5d) re-read as due/soon the
 * instant it was marked done and never left the grid — "done" looked like a no-op. So we also
 * hide it for the rest of the local day it was done (recurringDoneToday); it returns the next day.
 */
function isPlaced(
  task: Task,
  doneToday: Record<string, boolean>,
  timeZone: string,
): task is Task & { x: number; y: number } {
  if (task.staged) return false
  if (task.x == null || task.y == null) return false
  if (task.completed_at) return false
  // Dormant (paused / future start date): off the grid until its start date arrives, then it
  // wakes at its stored x/y. The list view's Paused group is where it lives meanwhile.
  if (isDormant(task, timeZone)) return false
  if (doneToday[task.id]) return false
  if (recurringDoneToday(task.recurring, timeZone)) return false
  const rc = recurringStatus(task.recurring)
  if (rc && rc.code === 'ok') return false
  return true
}

/**
 * The grid's data + interaction orchestration, lifted out of GridView so BOTH the canvas
 * (GridSurface) and the new-item card-in-place (rendered in the input widget above the grid —
 * B2) can share one set of drag/placement state. The caller creates `gridRef` (the canvas
 * surface) and hands it in; the drag hooks bind to it. All the intricate per-frame imperative
 * drag machinery moved here verbatim from the old GridView.
 *
 * `staged` stays the internal "not placed yet" marker (it also gates collision / visual-urgency /
 * plan-my-day), but there is no staging TRAY anymore: a freshly added Manual task surfaces as a
 * draggable card in the widget (see TaskInputWidget) and reaches the grid via `startNewCardDrag`,
 * which materializes it (flips `staged:false`) exactly like the old tray drag.
 */
export function useGrid(gridRef: RefObject<HTMLDivElement>) {
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
  //
  // A CLUSTER BUBBLE also registers here (GridSurface, keyed by its dominant task id) so the
  // merge preview can flag a bubble the same way it flags a standalone card — a folded co-member
  // has no card node of its own, but its bubble does. A dominant id never collides with a
  // standalone card (a clustered task renders as the bubble, not a card).
  const cardNodesRef = useRef(new Map<string, HTMLDivElement>())
  const registerCardNode = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) cardNodesRef.current.set(id, node)
    else cardNodesRef.current.delete(id)
  }, [])

  // Once a new-item card / cluster-popup row is "materialized" (flipped to a placed card so a
  // real GridCard mounts under the pointer), hold its id here so the move loop commits that flip
  // exactly once instead of on every frame while the mount is in flight.
  const materializedRef = useRef<string | null>(null)
  // The DOM nodes currently flagged `data-merge-target` (the merge preview): each is a standalone
  // under-card AND/OR the cluster bubble a folded co-member is drawn inside. A Set of nodes mutated
  // via plain DOM attributes — never React state — to keep the per-frame model fully imperative.
  const mergeTargetNodesRef = useRef<Set<HTMLDivElement>>(new Set())
  // Live mirror of `placedTasks` for the per-frame handlers (kept off the callback deps so the
  // handlers stay stable yet always read the latest committed positions).
  const placedTasksRef = useRef<Array<Task & { x: number; y: number }>>([])
  // Live mirror of `memberToNodeKey` (placed-task id → the id its on-screen node is registered
  // under) for the per-frame merge preview; updated in an effect so it tracks each committed render.
  const memberToNodeKeyRef = useRef<Map<string, string>>(new Map())

  // Minimal-mutation apply of the merge-preview flag: diff the incoming node set against the
  // currently-flagged one, so we only touch the DOM for nodes that actually entered/left the
  // preview (no per-frame attribute churn that would restart the CSS transition).
  const applyMergeTargets = useCallback((next: Set<HTMLDivElement>) => {
    const prev = mergeTargetNodesRef.current
    for (const node of prev) if (!next.has(node)) node.removeAttribute('data-merge-target')
    for (const node of next) if (!prev.has(node)) node.setAttribute('data-merge-target', '')
    mergeTargetNodesRef.current = next
  }, [])

  // Preview the merge-on-drop by running the ACTUAL drop predicate every frame (fix, item 14):
  // `mergePreviewIds` clusters the live placed set with the dragged card moved to the pointer point
  // and returns exactly the ids it would merge with on release — the same seed-based `computeClusters`
  // the drop runs, so the preview can never diverge from what actually happens. Each would-merge id
  // then resolves to its on-screen node: a standalone card (node under its own id) or the cluster
  // BUBBLE a folded task is drawn inside (node under the dominant id — see `memberToNodeKey`). This
  // replaces the old nearest-single-card heuristic, which flagged only one card, skipped folded
  // cards entirely, and mismatched near cluster boundaries. O(n²) over a handful of cards.
  const updateMergeTarget = useCallback(
    (draggedId: string, point: NormalizedPoint) => {
      const next = new Set<HTMLDivElement>()
      for (const id of mergePreviewIds(placedTasksRef.current, draggedId, point)) {
        const key = memberToNodeKeyRef.current.get(id)
        const node = key ? cardNodesRef.current.get(key) : undefined
        if (node) next.add(node)
      }
      applyMergeTargets(next)
    },
    [applyMergeTargets],
  )

  const clearMergeTarget = useCallback(() => {
    applyMergeTargets(new Set())
  }, [applyMergeTargets])

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

  // Shared move handler for all three drags (reposition, new-item → grid, popup drag-out). If the
  // dragged task isn't on the grid yet (a still-staged new-item card), flip it to placed ONCE so a
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

  // The cluster-popup row currently in inline-edit mode (a plain tap opens editing rather than
  // tearing the card out — item 16).
  const [editingClusterRowId, setEditingClusterRowId] = useState<string | null>(null)
  const startClusterRowEdit = useCallback((id: string) => setEditingClusterRowId(id), [])
  const stopClusterRowEdit = useCallback(() => setEditingClusterRowId(null), [])
  // Open / close / switch the cluster popup. Always resets the inline editor together with the
  // popup so a stale row-edit id can never re-open an editor in a reopened or different popup —
  // done here at the single state transition instead of in a syncing effect.
  const selectCluster = useCallback((id: string | null) => {
    setOpenClusterId(id)
    setEditingClusterRowId(null)
  }, [])

  // Size-aware drop clamp shared by every grid drag (reposition / new-item / popup drag-out) and
  // tap-to-place: keeps the CARD's whole bounding box inside the surface, sized to the LIVE grid
  // rect, so a card never overhangs an edge to be clipped by `overflow-hidden` (item 17).
  const cardClamp = useCallback(
    (rect: SurfaceRect): ClampBounds => boxClampBounds(rect, CARD_HALF_WIDTH, CARD_HALF_HEIGHT),
    [],
  )

  const placedTasks = useMemo(
    () =>
      tasks.filter((t): t is Task & { x: number; y: number } =>
        isPlaced(t, doneToday ?? {}, timeZone),
      ),
    [tasks, doneToday, timeZone],
  )
  // Keep the per-frame drag handlers reading fresh committed positions without re-subscribing.
  // Updated in an effect (not during render) so the ref stays in step with each committed render.
  useEffect(() => {
    placedTasksRef.current = placedTasks
  })
  // Tasks not placed on the grid yet (still `staged`). They render as draggable "new item" cards
  // in the input widget (card-in-place, B2) instead of a separate staging tray. A completed one-off
  // task keeps staged=true (completion never clears the staged flag), so it must be excluded here
  // the same way isPlaced excludes it on the placed grid — completed_at is the permanent across-day
  // hide, doneToday the same-day belt-and-suspenders. Without this, a still-unplaced task marked
  // done (e.g. from the list) leaves the list but reappears as a "new item" card AND survives the
  // daily reset (staged never resets) — the "ghost item" bug PR #191 missed on this fifth surface.
  const pendingTasks = useMemo(
    () =>
      tasks.filter(
        (t) => t.staged && !t.completed_at && !(doneToday ?? {})[t.id] && !isDormant(t, timeZone),
      ),
    [tasks, doneToday, timeZone],
  )

  // Dormant (paused / future start_date) tasks that already have a grid spot. `isPlaced` drops
  // them (dormancy hides a task from the active board), so they render as their OWN read-only
  // "set aside" pass BEHIND the clustered active cards (GridSurface) — a paused card still shows
  // WHERE it will land when it wakes, without joining clustering or the drag/merge machinery
  // (folding a paused card into an active cluster would break placement and let it be dragged).
  // Same completed/staged exclusions as `isPlaced`; the only difference is it KEEPS the ones
  // `isPlaced` drops solely for being dormant. Not registered as cluster nodes.
  const dormantPlaced = useMemo(
    () =>
      tasks.filter(
        (t): t is Task & { x: number; y: number } =>
          !t.staged &&
          t.x != null &&
          t.y != null &&
          !t.completed_at &&
          !(doneToday ?? {})[t.id] &&
          isDormant(t, timeZone),
      ),
    [tasks, doneToday, timeZone],
  )

  const softDeleteMutate = softDelete.mutate
  const markDoneMutate = markDone.mutate

  // --- Mark done (shared by grid cards + popup rows) -------------------------------------
  // Normal task: write history + today's daily_state (it leaves the grid). Recurring task:
  // reset the cycle (lastDoneAt=now, doneCount+1) WITHOUT touching history/daily_state — it is
  // then hidden from the board for the rest of the local day (recurringDoneToday) and returns the
  // next day when its cadence next reads due/soon. Closes any open popup.
  const handleDone = useCallback(
    (task: Task) => {
      selectCluster(null)
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
    [markDoneMutate, updateMutate, timeZone, selectCluster],
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
    clamp: cardClamp,
  })

  // --- New-item card → grid drag (desktop) -----------------------------------------------
  const handleNewCardDrop = useCallback(
    (id: string, point: NormalizedPoint) => {
      updateMutate({ id, patch: { x: point.x, y: point.y, staged: false } })
      endDrag()
    },
    [updateMutate, endDrag],
  )
  const newCardDrag = useFreeDrag({
    surfaceRef: gridRef,
    onDrop: handleNewCardDrop,
    onMove: handleDragMove,
    clamp: cardClamp,
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
  // A popup row DEFERS its tear-out until the pointer actually moves (item 16): a plain tap opens
  // the row for inline editing (onTap), while crossing the drag threshold closes the popup
  // (onDragStart) and hands off to the shared move loop, which materializes a standalone card under
  // the pointer on the first move. Nothing is committed on a bare tap, so a click can no longer
  // rip the card out of the cluster.
  const popupDrag = useFreeDrag({
    surfaceRef: gridRef,
    onDrop: handlePopupDrop,
    onMove: handleDragMove,
    onDragStart: () => selectCluster(null),
    onTap: startClusterRowEdit,
    clamp: cardClamp,
    activateOnMove: true,
  })
  const startPopupRow = popupDrag.startDrag
  const startPopupRowDrag = useCallback((task: Task) => startPopupRow(task.id), [startPopupRow])

  // --- Tap-to-place (mobile / touch) + background click (close popup) ---------------------
  const handleGridPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      // A click on empty canvas always dismisses an open cluster popup.
      selectCluster(null)
      if (!isMobile || !placingId) return
      const rect = gridRef.current?.getBoundingClientRect()
      if (!rect) return
      const point = toNormalized(rect, event.clientX, event.clientY, cardClamp(rect))
      updateMutate({ id: placingId, patch: { x: point.x, y: point.y, staged: false } })
      setPlacingId(null)
    },
    [isMobile, placingId, updateMutate, gridRef, cardClamp, selectCluster],
  )

  const togglePlacing = useCallback((id: string) => {
    setPlacingId((cur) => (cur === id ? null : id))
  }, [])

  // The id currently being dragged (reposition, new-item → grid, or popup drag-out) — suppresses
  // its transition and lifts it while it moves.
  const draggingId = reposition.draggingId ?? newCardDrag.draggingId ?? popupDrag.draggingId

  // Cluster over everything EXCEPT the dragged card (mirrors EisenClaw's `staticCards`,
  // planner.html:560). The dragged card renders standalone below so its DOM node stays mounted
  // for direct-DOM movement and it can never fold into a bubble mid-drag.
  const clusters = useMemo(
    () => computeClusters(placedTasks.filter((t) => t.id !== draggingId)),
    [placedTasks, draggingId],
  )
  const draggedTask = draggingId ? placedTasks.find((t) => t.id === draggingId) : undefined

  // Map each rendered placed-task id → the id its on-screen node is registered under: its own id
  // when it renders as a standalone card, or the cluster's DOMINANT id when it is folded into a
  // bubble (GridSurface registers the bubble node under `dominant.id`, computed the SAME way here
  // so the keys match). The merge preview resolves a would-merge co-member to the actual node to
  // flag — including a card only visible as part of a bubble. Rebuilt when the clusters change.
  const memberToNodeKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of clusters) {
      const key = group.length === 1 ? group[0]!.id : clusterDominant(group, { timeZone }).id
      for (const t of group) map.set(t.id, key)
    }
    return map
  }, [clusters, timeZone])
  // Keep the per-frame merge preview reading a fresh member→node map without re-subscribing.
  useEffect(() => {
    memberToNodeKeyRef.current = memberToNodeKey
  })

  return {
    // Data
    timeZone,
    placedTasks,
    pendingTasks,
    dormantPlaced,
    clusters,
    draggedTask,
    draggingId,
    // Placed-card render wiring
    registerCardNode,
    startReposition: reposition.startDrag,
    updateMutate,
    softDeleteMutate,
    handleDone,
    // Cluster popup + background
    openClusterId,
    selectCluster,
    startPopupRowDrag,
    editingClusterRowId,
    startClusterRowEdit,
    stopClusterRowEdit,
    handleGridPointerDown,
    // Clustering helpers (recurring-aware) for the bubble render
    clusterDominant,
    clusterAccentColor,
    clusterNearestDue,
    urgencyGlowStyle,
    // New-item card-in-place (rendered in the input widget's Manual mode)
    isMobile,
    placingId,
    togglePlacing,
    startNewCardDrag: newCardDrag.startDrag,
  }
}

export type GridApi = ReturnType<typeof useGrid>
