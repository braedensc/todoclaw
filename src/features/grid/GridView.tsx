import { useCallback, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { Task } from '../../types/task'
import { useSoftDeleteTask, useTasks, useUpdateTask } from '../tasks/use-tasks'
import { useUserSchedule } from '../schedule/use-user-schedule'
import { useDailyState } from '../daily-state/use-daily-state'
import { recurringStatus } from '../../lib/recurring'
import { useFreeDrag, toNormalized, type NormalizedPoint } from '../../hooks/use-free-drag'
import { useIsMobile } from '../../hooks/use-is-mobile'
import { GridCanvas } from './GridCanvas'
import { GridCard } from './GridCard'
import { StagingTray } from './StagingTray'

// Browser default IANA zone — used only when the user_schedule row hasn't loaded yet, so the
// daily-state "done today" filter still resolves against a sane local day.
const FALLBACK_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

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
  const { data: schedule } = useUserSchedule()
  const timeZone = schedule?.timezone ?? FALLBACK_TZ
  const { data: daily } = useDailyState(timeZone)
  const doneToday = daily?.done

  const updateTask = useUpdateTask()
  const softDelete = useSoftDeleteTask()

  // Live "ghost" position for the card under drag, so it tracks the pointer before the write
  // lands. Keyed by id; cleared on drop.
  const [ghost, setGhost] = useState<{ id: string; point: NormalizedPoint } | null>(null)

  // Tap-to-place selection (mobile / touch): the tray task awaiting a grid tap.
  const [placingId, setPlacingId] = useState<string | null>(null)

  const placedTasks = useMemo(
    () => tasks.filter((t): t is Task & { x: number; y: number } => isPlaced(t, doneToday ?? {})),
    [tasks, doneToday],
  )
  const stagedTasks = useMemo(() => tasks.filter((t) => t.staged), [tasks])

  const updateMutate = updateTask.mutate

  // --- Reposition (grid card) drag -------------------------------------------------------
  const handleRepositionDrop = useCallback(
    (id: string, point: NormalizedPoint) => {
      setGhost(null)
      // No collision resolution on drag — overlap is fine (clustering handles it later).
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

  // --- Tap-to-place (mobile / touch) -----------------------------------------------------
  const handleGridPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
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

          {placedTasks.map((task) => {
            const live = ghost?.id === task.id ? ghost.point : { x: task.x, y: task.y }
            // Data-space → screen: x left→right, y inverted (high importance = top).
            return (
              <GridCard
                key={task.id}
                task={task}
                screenX={live.x}
                screenY={1 - live.y}
                dragging={draggingId === task.id}
                onPointerDown={reposition.startDrag(task.id)}
                onRename={(text) => updateMutate({ id: task.id, patch: { text } })}
                onDelete={() => softDelete.mutate(task.id)}
                onBackToTray={() => updateMutate({ id: task.id, patch: { staged: true } })}
              />
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
