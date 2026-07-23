import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { Task } from '../../types/task'
import type { QuadrantKey } from '../../lib/quadrants'
import { quadrantMeta } from '../../lib/quadrants'
import { QUADRANT_CENTER } from '../../lib/quadrant-summary'
import { daysUntil } from '../../lib/scoring'
import { minutesUntilDueTime } from '../../lib/dates'
import { clusterStaleness, staleRingStyle, urgencyTier } from '../../lib/visual-urgency'
import { useNow } from '../../hooks/use-now'
import { useElementSize } from '../../hooks/use-element-size'
import { boxClampBounds, clampPoint, toNormalized } from '../../hooks/use-free-drag'
import { BACKGROUND_DISMISS_ATTR } from '../../hooks/use-background-dismiss'
import { useConfirm } from '../../components/use-confirm'
import { useToast } from '../../components/use-toast'
import { useTaskReminders, useTaskReminderWrites } from '../reminders/use-task-reminders'
import { useSetDueWithDefaultReminder } from '../schedule/use-set-due'
import { MobileAddSheet } from '../shell/MobileAddSheet'
import { ClusterBubble } from '../clustering/ClusterBubble'
import { CLUSTER_BUBBLE_HALF } from '../clustering/cluster-constants'
import { PawPrintShape, PawTrail } from './PawTrail'
import { useHoldDrag } from './use-hold-drag'
import type { GridApi } from './use-grid'
import {
  AXIS_LABEL_COLOR,
  AXIS_COLOR,
  GRIDLINE_COLOR,
  QUADRANT_TINT,
  TOUCH_CHIP_HALF_HEIGHT,
  TOUCH_CHIP_HALF_WIDTH,
} from './grid-constants'
import { TouchGridChip } from './TouchGridChip'
import { TouchTaskSheet } from './TouchTaskSheet'
import { TouchClusterSheet } from './TouchClusterSheet'

// Corner quadrant labels (the grid is y-inverted on screen — high importance on top).
const SCHEDULE = quadrantMeta(0.25, 0.75)
const DO_NOW = quadrantMeta(0.75, 0.75)
const SOMEDAY = quadrantMeta(0.25, 0.25)
const ERRANDS = quadrantMeta(0.75, 0.25)

// Same paper composition as GridCanvas (center axes over 10×10 graph lines), painted on the
// SAFE-AREA-PADDED coordinate surface — not the full-bleed backdrop — so the visual center
// always matches data (0.5, 0.5) even when the top/bottom insets are asymmetric.
const PAPER_STYLE = {
  backgroundImage: [
    `linear-gradient(to right, transparent calc(50% - 0.75px), ${AXIS_COLOR} calc(50% - 0.75px), ${AXIS_COLOR} calc(50% + 0.75px), transparent calc(50% + 0.75px))`,
    `linear-gradient(to bottom, transparent calc(50% - 0.75px), ${AXIS_COLOR} calc(50% - 0.75px), ${AXIS_COLOR} calc(50% + 0.75px), transparent calc(50% + 0.75px))`,
    `linear-gradient(to right, ${GRIDLINE_COLOR} 1px, transparent 1px)`,
    `linear-gradient(to bottom, ${GRIDLINE_COLOR} 1px, transparent 1px)`,
  ].join(','),
  backgroundSize: '100% 100%, 100% 100%, 10% 10%, 10% 10%',
}

export interface TouchGridSurfaceProps {
  grid: GridApi
  /** The coordinate surface ref (created by WorkArea, shared with useGrid's clamp/tap math). */
  gridRef: RefObject<HTMLDivElement>
  /** Leave grid view — routes through history (use-grid-only), like the Back gesture. */
  onExit: () => void
  /** Open the BabyClaw chat over the grid — chat stays reachable in every mode. */
  onOpenChat: () => void
  /** Unread chat count for the floating chat button's badge dot. */
  chatUnread?: number
}

/**
 * The fullscreen TOUCH grid (grid-only mode on phones, and on any coarse-pointer device at
 * desktop widths — landscape phones, iPads). The screen IS the canvas: quadrant tints, graph
 * paper, and chips fill the safe-area box edge to edge, adopting the screen's aspect (decided
 * 2026-07-22 — coordinates are normalized, so scoring/clustering math is untouched; only the
 * cluster threshold's on-screen ellipse changes shape).
 *
 * Interaction contract (the touch grammar): tap a chip → TouchTaskSheet with every card action;
 * tap a cluster bubble → TouchClusterSheet → pick a member; Move = tap-to-place (arm from the
 * sheet, tap the spot); ＋ opens the same MobileAddSheet as the bottom nav; 🐾 opens chat; exit
 * via the ✕ pill or the system Back gesture (grid-only holds a history entry). Repositioning is
 * press-and-hold drag (useHoldDrag — lift, finger-offset ghost, crosshairs, quadrant outline);
 * ⇢ Move in the sheet stays the tap-to-place precision path.
 */
export function TouchGridSurface({
  grid,
  gridRef,
  onExit,
  onOpenChat,
  chatUnread = 0,
}: TouchGridSurfaceProps) {
  const {
    timeZone,
    placedTasks,
    dormantPlaced,
    clusters,
    handleDone,
    updateMutate,
    softDeleteMutate,
    clusterDominant,
    clusterAccentColor,
    clusterNearestDue,
    urgencyGlowStyle,
  } = grid

  const confirm = useConfirm()
  const showToast = useToast()
  const now = useNow()
  const { data: reminders } = useTaskReminders()
  const reminderWrites = useTaskReminderWrites()
  const setDue = useSetDueWithDefaultReminder()

  const gridSize = useElementSize(gridRef)
  const chipBounds = boxClampBounds(gridSize, TOUCH_CHIP_HALF_WIDTH, TOUCH_CHIP_HALF_HEIGHT)
  const bubbleBounds = boxClampBounds(gridSize, CLUSTER_BUBBLE_HALF, CLUSTER_BUBBLE_HALF)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [clusterId, setClusterId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // Completion paw stamp — same 900ms flourish as the desktop grid (see GridSurface's
  // doneWithStamp): one fading print blooms at the chip's stored x/y as it leaves the board.
  // Skipped under reduced motion and in jsdom (no matchMedia).
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

  // Everything derives from live query data, so a task completed or deleted elsewhere (another
  // device, realtime) closes its own sheet / cancels its own move by simply vanishing.
  const selected =
    placedTasks.find((t) => t.id === selectedId) ??
    dormantPlaced.find((t) => t.id === selectedId) ??
    null
  const selectedPaused = selected != null && dormantPlaced.some((t) => t.id === selected.id)
  const openGroup =
    clusters.find((g) => g.length > 1 && clusterDominant(g, { timeZone }).id === clusterId) ?? null
  const movingTask = placedTasks.find((t) => t.id === movingId) ?? null

  const daysFor = (task: Task) => daysUntil(task.due, { timeZone })
  const minutesFor = (task: Task) => minutesUntilDueTime(task.due, task.due_time, timeZone, now)

  // ---- Hold-to-drag (the touch reposition path; ⇢ Move in the sheet stays the precision one).
  // Painting is direct-DOM at pointer rate, like the desktop grid's paintDragFrame: React state
  // only marks the lift/drop transitions. Chip nodes register here; a style snapshot taken at
  // lift restores the exact resting inline styles on abort (React skips re-writing style props
  // whose values it last rendered, so an aborted drag would otherwise strand the chip where the
  // finger left it).
  const chipNodes = useRef(new Map<string, HTMLButtonElement>())
  const savedStyle = useRef<Record<string, string> | null>(null)
  const crossXRef = useRef<HTMLDivElement>(null)
  const crossYRef = useRef<HTMLDivElement>(null)
  const quadHiRef = useRef<HTMLDivElement>(null)
  const registerChip = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) chipNodes.current.set(id, node)
    else chipNodes.current.delete(id)
  }

  const drag = useHoldDrag({
    surfaceRef: gridRef,
    clamp: (rect) => boxClampBounds(rect, TOUCH_CHIP_HALF_WIDTH, TOUCH_CHIP_HALF_HEIGHT),
    onTap: (id) => setSelectedId(id),
    onLift: (id) => {
      navigator.vibrate?.(10)
      const n = chipNodes.current.get(id)
      if (!n) return
      savedStyle.current = {
        left: n.style.left,
        top: n.style.top,
        transform: n.style.transform,
        boxShadow: n.style.boxShadow,
        zIndex: n.style.zIndex,
        borderTopColor: n.style.borderTopColor,
      }
      n.style.zIndex = '30'
      n.style.transform = 'translate(-50%, -50%) scale(1.12)'
      n.style.boxShadow = '0 10px 22px rgba(0,0,0,0.26), 0 0 0 2px rgba(46,42,36,0.25)'
    },
    onFrame: (id, p) => {
      const n = chipNodes.current.get(id)
      const task = placedTasks.find((t) => t.id === id)
      if (n) {
        n.style.left = `${p.x * 100}%`
        n.style.top = `${(1 - p.y) * 100}%`
        // Live quadrant border, like the desktop drag frame — recurring keeps its status color.
        if (!task?.recurring) n.style.borderTopColor = quadrantMeta(p.x, p.y).color
      }
      const q = quadrantMeta(p.x, p.y)
      if (crossXRef.current) {
        crossXRef.current.style.display = 'block'
        crossXRef.current.style.top = `${(1 - p.y) * 100}%`
      }
      if (crossYRef.current) {
        crossYRef.current.style.display = 'block'
        crossYRef.current.style.left = `${p.x * 100}%`
      }
      if (quadHiRef.current) {
        quadHiRef.current.style.display = 'block'
        quadHiRef.current.style.left = p.x >= 0.5 ? '50%' : '0'
        quadHiRef.current.style.top = p.y >= 0.5 ? '0' : '50%'
        quadHiRef.current.style.outlineColor = q.color
      }
    },
    onLiftEnd: (id) => {
      if (crossXRef.current) crossXRef.current.style.display = 'none'
      if (crossYRef.current) crossYRef.current.style.display = 'none'
      if (quadHiRef.current) quadHiRef.current.style.display = 'none'
      const n = chipNodes.current.get(id)
      if (n && savedStyle.current) {
        // Restore the exact resting inline styles; a committed drop then re-renders with the
        // new coords, an abort settles the chip back where it was.
        for (const [prop, value] of Object.entries(savedStyle.current)) {
          n.style[prop as 'left'] = value
        }
      }
      savedStyle.current = null
    },
    onDrop: (id, p) => updateMutate({ id, patch: { x: p.x, y: p.y, staged: false } }),
  })

  // Escape disarms tap-to-place move mode (capture + stopPropagation so the same press can't
  // also exit grid-only via App's window-level listener) — review follow-up, WCAG keyboard path.
  useEffect(() => {
    if (!movingId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setMovingId(null)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [movingId])

  // Tap-to-place commit: a press on the coordinate surface ITSELF while a move is armed drops
  // the task there. The target guard is load-bearing (touch-grid review): the floating chrome
  // (✕ / Cancel / ＋ / 🐾) lives inside this div, and a real tap fires pointerdown BEFORE click —
  // without the guard, tapping Cancel would commit the move at the banner's coordinates and only
  // then disarm. Every backdrop layer is pointer-events-none and the chips go pointer-events-none
  // during a move, so genuine canvas taps do target the canvas node — the whole board stays a
  // valid drop target while the buttons stay buttons.
  const handleSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!movingTask) return
    if (event.target !== event.currentTarget) return
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return
    const point = toNormalized(rect, event.clientX, event.clientY, chipBounds)
    updateMutate({ id: movingTask.id, patch: { x: point.x, y: point.y, staged: false } })
    setMovingId(null)
  }

  const handleDelete = async (task: Task) => {
    if (
      await confirm({
        title: `Delete “${task.text}”?`,
        message: 'This removes it from your grid.',
      })
    ) {
      softDeleteMutate(task.id)
    }
    setSelectedId(null)
  }

  return (
    <div className="fixed inset-0 z-50 bg-bg">
      {/* Safe-area frame: the coordinate surface is the PADDED box, so chips, tints, and the
          painted center axes all share one geometry. Insets go in classes (jsdom drops inline
          env()); the full-bleed strips outside show warm paper, like the shell's body padding. */}
      <div className="h-full w-full pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] pt-[env(safe-area-inset-top,0px)]">
        <div
          ref={gridRef}
          data-testid="touch-grid-canvas"
          {...{ [BACKGROUND_DISMISS_ATTR]: true }}
          onPointerDown={handleSurfacePointerDown}
          className="relative h-full w-full overflow-hidden"
          style={PAPER_STYLE}
        >
          {/* Quadrant tints — every backdrop layer is pointer-events-none so only the canvas
              itself counts as background (dismiss + tap-to-place both key off it). */}
          <div
            className="pointer-events-none absolute left-0 top-0 h-1/2 w-1/2"
            style={{ background: QUADRANT_TINT.schedule }}
          />
          <div
            className="pointer-events-none absolute right-0 top-0 h-1/2 w-1/2"
            style={{ background: QUADRANT_TINT['do-now'] }}
          />
          <div
            className="pointer-events-none absolute bottom-0 left-0 h-1/2 w-1/2"
            style={{ background: QUADRANT_TINT.someday }}
          />
          <div
            className="pointer-events-none absolute bottom-0 right-0 h-1/2 w-1/2"
            style={{ background: QUADRANT_TINT.errands }}
          />

          {/* Decorative character layer, same as GridCanvas: the paw trail wandering toward
              Do Now and the tiny ring marking the grid's true center. Both pointer-events-none. */}
          <PawTrail />
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-muted-faint bg-bg"
          />

          {/* Corner quadrant labels + edge axis labels. */}
          <span
            className="pointer-events-none absolute left-2.5 top-2 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: SCHEDULE.color }}
          >
            {SCHEDULE.label}
          </span>
          <span
            className="pointer-events-none absolute right-2.5 top-2 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: DO_NOW.color }}
          >
            {DO_NOW.label}
          </span>
          <span
            className="pointer-events-none absolute bottom-2 left-2.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: SOMEDAY.color }}
          >
            {SOMEDAY.label}
          </span>
          <span
            className="pointer-events-none absolute bottom-2 right-2.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: ERRANDS.color }}
          >
            {ERRANDS.label}
          </span>
          <span
            aria-hidden
            className="pointer-events-none absolute bottom-7 right-2.5 text-[9px] font-bold uppercase tracking-[0.14em]"
            style={{ color: AXIS_LABEL_COLOR }}
          >
            Urgency →
          </span>
          <span
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 origin-left -rotate-90 text-[9px] font-bold uppercase tracking-[0.14em]"
            style={{ color: AXIS_LABEL_COLOR }}
          >
            Importance →
          </span>

          {/* Empty state. */}
          {placedTasks.length === 0 && dormantPlaced.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted">
              No tasks placed yet — tap ＋ to add one.
            </div>
          )}

          {/* Dormant (paused) chips — read-only pass BEHIND active chips, never clustered. */}
          <div data-testid="chip-layer" className={movingTask ? 'pointer-events-none' : undefined}>
            {dormantPlaced.map((task) => {
              const p = clampPoint(task.x, task.y, chipBounds)
              return (
                <TouchGridChip
                  key={task.id}
                  task={task}
                  screenX={p.x}
                  screenY={1 - p.y}
                  daysUntilDue={daysFor(task)}
                  minutesUntilDue={minutesFor(task)}
                  paused
                  onTap={() => setSelectedId(task.id)}
                />
              )
            })}

            {/* Active chips + cluster bubbles (same cluster data as desktop). Placed tasks
                always carry coordinates; the ?? 0.5 fallbacks only satisfy the wider Task type
                the cluster groups are typed with. */}
            {clusters.map((group) => {
              if (group.length === 1) {
                const task = group[0]
                if (!task) return null
                const p = clampPoint(task.x ?? 0.5, task.y ?? 0.5, chipBounds)
                return (
                  <TouchGridChip
                    key={task.id}
                    task={task}
                    screenX={p.x}
                    screenY={1 - p.y}
                    daysUntilDue={daysFor(task)}
                    minutesUntilDue={minutesFor(task)}
                    dimmed={movingId === task.id}
                    chipRef={registerChip(task.id)}
                    onHoldStart={drag.startHold(task.id)}
                    onTap={() => setSelectedId(task.id)}
                  />
                )
              }
              const dominant = clusterDominant(group, { timeZone })
              const p = clampPoint(dominant.x ?? 0.5, dominant.y ?? 0.5, bubbleBounds)
              const open = clusterId === dominant.id
              return (
                <ClusterBubble
                  key={dominant.id}
                  group={group}
                  accentColor={clusterAccentColor(group, { timeZone })}
                  screenX={p.x}
                  screenY={1 - p.y}
                  glow={urgencyGlowStyle(urgencyTier(clusterNearestDue(group, { timeZone }), null))}
                  staleRing={staleRingStyle(clusterStaleness(group, { timeZone }))}
                  open={open}
                  onToggle={() => setClusterId(open ? null : dominant.id)}
                />
              )
            })}
          </div>

          {/* Hold-drag affordances, painted per frame by direct DOM (see the useHoldDrag wiring
              above): crosshairs marking the exact drop point and an outline on the quadrant the
              lifted chip is over. Hidden until a lift moves. */}
          <div
            ref={crossXRef}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 h-px bg-ink/30"
            style={{ display: 'none', zIndex: 14 }}
          />
          <div
            ref={crossYRef}
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-ink/30"
            style={{ display: 'none', zIndex: 14 }}
          />
          <div
            ref={quadHiRef}
            aria-hidden
            className="pointer-events-none absolute h-1/2 w-1/2"
            style={{
              display: 'none',
              zIndex: 4,
              outline: '2px solid',
              outlineOffset: -2,
              opacity: 0.5,
            }}
          />

          {/* Transient done stamps — see doneWithStamp above. Rendered after the chips so a
              print blooms over its neighbors, never under them. */}
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

          {/* Floating chrome, all inside the safe-area box. */}
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit grid view"
            className="absolute right-3 top-2 z-[60] flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary shadow-sm"
          >
            <span aria-hidden>✕</span> Exit grid
          </button>

          {movingTask && (
            /* role=status/aria-live announces the armed place mode to assistive tech; the Cancel
               inside is a full 44pt target (the banner's only control, and the only visible way
               out of the mode). */
            <div
              role="status"
              aria-live="polite"
              className="absolute left-1/2 top-2 z-[60] flex max-w-[80%] -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-puppy/50 bg-panel py-1 pl-4 pr-1 text-xs font-medium text-ink shadow-md"
            >
              <span className="truncate">Tap where “{movingTask.text}” should go</span>
              <button
                type="button"
                onClick={() => setMovingId(null)}
                className="min-h-[44px] rounded-full px-3 font-semibold text-danger"
              >
                Cancel
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setAddOpen(true)}
            aria-label="Add a task"
            className="absolute bottom-4 right-4 z-[60] flex h-[52px] w-[52px] items-center justify-center rounded-full bg-primary text-2xl font-semibold text-white shadow-lg"
          >
            ＋
          </button>

          <button
            type="button"
            onClick={onOpenChat}
            aria-label={chatUnread > 0 ? `Open chat — ${chatUnread} unread` : 'Open chat'}
            className="absolute bottom-4 left-4 z-[60] flex h-[52px] w-[52px] items-center justify-center rounded-full border border-border-strong bg-panel text-xl shadow-lg"
          >
            <span aria-hidden>🐾</span>
            {chatUnread > 0 && (
              <span
                data-testid="chat-unread-dot"
                aria-hidden
                className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-panel bg-accent"
              />
            )}
          </button>
        </div>
      </div>

      {/* Sheets (portaled to body → they stack over this in-tree z-50 overlay). The task sheet
          is keyed by task id so its rename draft / schedule disclosure reset per task. */}
      <TouchTaskSheet
        key={selected?.id ?? 'none'}
        task={selected}
        paused={selectedPaused}
        daysUntilDue={selected ? daysFor(selected) : null}
        minutesUntilDue={selected ? minutesFor(selected) : null}
        timeZone={timeZone}
        reminderOffsets={selected ? (reminders?.get(selected.id) ?? []) : []}
        onClose={() => setSelectedId(null)}
        onDone={() => {
          if (selected) doneWithStamp(selected)
          setSelectedId(null)
        }}
        onDelete={() => {
          if (selected) void handleDelete(selected)
        }}
        onRename={(text) => {
          if (selected) updateMutate({ id: selected.id, patch: { text } })
        }}
        onMove={() => {
          if (selected) setMovingId(selected.id)
          setSelectedId(null)
        }}
        onSetDue={(due, dueTime) => {
          if (selected) setDue(selected, due, dueTime)
        }}
        onSetRecurring={(frequencyDays) => {
          if (selected)
            updateMutate({
              id: selected.id,
              patch: {
                recurring: { frequencyDays, lastDoneAt: null, doneCount: 0 },
                ongoing: false,
              },
            })
        }}
        onSetFrequency={(frequencyDays) => {
          if (selected?.recurring)
            updateMutate({
              id: selected.id,
              patch: { recurring: { ...selected.recurring, frequencyDays } },
            })
        }}
        onRemoveRecurring={() => {
          if (selected) updateMutate({ id: selected.id, patch: { recurring: null } })
        }}
        onSetOngoing={(on) => {
          if (selected)
            updateMutate({
              id: selected.id,
              patch: on ? { ongoing: true, recurring: null } : { ongoing: false },
            })
        }}
        onSetStartDate={(startDate) => {
          if (selected) updateMutate({ id: selected.id, patch: { start_date: startDate } })
        }}
        onToggleReminder={(minutes) => {
          if (selected)
            reminderWrites.toggle(selected.id, minutes, reminders?.get(selected.id) ?? [])
        }}
        onClearReminders={() => {
          if (selected) reminderWrites.clear(selected.id)
        }}
      />

      <TouchClusterSheet
        group={openGroup}
        timeZone={timeZone}
        onClose={() => setClusterId(null)}
        onPick={(task) => {
          setClusterId(null)
          setSelectedId(task.id)
        }}
      />

      <MobileAddSheet
        open={addOpen}
        defaultQuadrant={null}
        onAdded={(dest: QuadrantKey) => {
          const c = QUADRANT_CENTER[dest]
          showToast(`Added to ${quadrantMeta(c.x, c.y).label} ✓`)
        }}
        onOpenChat={onOpenChat}
        onClose={() => setAddOpen(false)}
      />
    </div>
  )
}
