import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'
import type { Task } from '../../types/task'
import { useSoftDeleteTask, useTasks, useUpdateTask } from '../tasks/use-tasks'
import { useMarkTaskDone } from '../done/use-history'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { recurringStatus } from '../../lib/recurring'
import { quadrantMeta } from '../../lib/quadrants'
import { urgencyGlowStyle } from '../../lib/visual-urgency'
import {
  clusterAccentColor,
  clusterDominant,
  clusterNearestDue,
  computeClusters,
  mergePreviewIds,
} from '../../lib/clustering'
import { useFreeDrag, toNormalized, type NormalizedPoint } from '../../hooks/use-free-drag'
import { useIsMobile } from '../../hooks/use-is-mobile'

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

  const placedTasks = useMemo(
    () => tasks.filter((t): t is Task & { x: number; y: number } => isPlaced(t, doneToday ?? {})),
    [tasks, doneToday],
  )
  // Keep the per-frame drag handlers reading fresh committed positions without re-subscribing.
  // Updated in an effect (not during render) so the ref stays in step with each committed render.
  useEffect(() => {
    placedTasksRef.current = placedTasks
  })
  // Tasks not placed on the grid yet (still `staged`). They render as draggable "new item" cards
  // in the input widget (card-in-place, B2) instead of a separate staging tray.
  const pendingTasks = useMemo(() => tasks.filter((t) => t.staged), [tasks])

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
    [popupDrag, updateMutate, gridRef],
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
    [isMobile, placingId, updateMutate, gridRef],
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
    setOpenClusterId,
    startPopupRowDrag,
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
