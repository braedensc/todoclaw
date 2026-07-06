import { useState } from 'react'
import type { Task } from '../../types/task'
import { useTasks, useUpdateTask, useAddTask } from '../tasks/use-tasks'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { quadrantMeta, type QuadrantKey } from '../../lib/quadrants'
import {
  summarizeQuadrants,
  moveToQuadrant,
  placeInQuadrant,
  QUADRANT_ORDER,
  QUADRANT_CENTER,
  QUADRANT_SUBTITLE,
} from '../../lib/quadrant-summary'
import { QUADRANT_TINT } from '../grid/grid-constants'
import { ListView } from '../list/ListView'
import { MoveToQuadrantSheet } from './MoveToQuadrantSheet'
import { AddTaskSheet } from './AddTaskSheet'

// MobileMatrix — the phone (< 720px) reinterpretation of the priority matrix (Concept C, ADR-0025).
// A pixel-drag grid is a poor fit for a thumb, so on mobile the two jobs the matrix does are split
// across two coordinated views: an OVERVIEW (a read-only 2×2 minimap answering "what's the whole
// picture / what's on fire") and a FOCUS list (one quadrant as a comfortable, full-width list where
// real work happens — the existing ListView, scoped by `quadrantFilter`).
//
// Rows keep every ListView interaction (complete / edit / delete / expand / recurring), plus a
// tap-based "Move to quadrant" picker (MoveToQuadrantSheet) — the no-drag reposition path — and an
// "Add task" sheet (AddTaskSheet) that creates a task already placed in a quadrant, so a phone user
// never has to switch to the Grid view to add. Desktop never mounts this — WorkArea renders it only
// below the breakpoint (useIsMobile).

// Label + color for a quadrant, read from the canonical quadrantMeta at its band center.
function meta(key: QuadrantKey) {
  const c = QUADRANT_CENTER[key]
  return quadrantMeta(c.x, c.y)
}

const shell = 'rounded-xl border border-border-strong bg-panel p-4'

// The dashed "+ Add" affordance, shared by overview and focus.
const addButtonClass =
  'flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-panel py-3 text-sm font-semibold text-primary transition-colors hover:bg-bg'

export function MobileMatrix() {
  const { data: tasks, isLoading, isError } = useTasks()
  const timeZone = useTimeZone()
  const { data: daily } = useDailyState(timeZone)
  const updateTask = useUpdateTask()
  const addTask = useAddTask()
  const [focus, setFocus] = useState<QuadrantKey | null>(null)
  // The task whose quadrant is being changed via the tap picker (null = sheet closed).
  const [moveTask, setMoveTask] = useState<Task | null>(null)
  // Whether the create-into-quadrant "Add task" sheet is open.
  const [adding, setAdding] = useState(false)

  if (isLoading) {
    return (
      <section aria-label="Quadrants" className={shell}>
        <p className="text-muted">Loading…</p>
      </section>
    )
  }
  if (isError || !tasks) {
    return (
      <section aria-label="Quadrants" className={shell}>
        <p className="text-accent">Could not load tasks.</p>
      </section>
    )
  }

  const doneToday = daily?.done ?? {}
  const active = tasks.filter((t) => !doneToday[t.id])
  const { buckets, maxCount } = summarizeQuadrants(active, { timeZone })

  // Commit a tap-picker move: snap to the chosen quadrant's center, collision-resolve against all
  // active tasks, write the coords, and close the sheet. Same coord path as a list-slider commit.
  const handleMove = (dest: QuadrantKey) => {
    if (!moveTask) return
    const { x, y } = moveToQuadrant(moveTask, dest, active)
    updateTask.mutate({ id: moveTask.id, patch: { x, y } })
    setMoveTask(null)
  }

  // Create a task already placed in the chosen quadrant (center → collision-resolve), staged:false,
  // then close the sheet. The overview count / focus list pick it up on the next fetch.
  const handleAdd = (text: string, dest: QuadrantKey) => {
    const { x, y } = placeInQuadrant(dest, active)
    addTask.mutate({ text, x, y, staged: false })
    setAdding(false)
  }

  // The move + add sheets — shared across overview/focus; each open while its state is set. The add
  // sheet pre-selects the focused quadrant (null in the overview → the user picks).
  const moveSheet = (
    <MoveToQuadrantSheet
      task={moveTask}
      currentKey={moveTask ? quadrantMeta(moveTask.x ?? 0.5, moveTask.y ?? 0.5).key : null}
      onPick={handleMove}
      onClose={() => setMoveTask(null)}
    />
  )
  const addSheet = (
    <AddTaskSheet
      open={adding}
      defaultQuadrant={focus}
      onAdd={handleAdd}
      onClose={() => setAdding(false)}
    />
  )

  // ---- FOCUS: one quadrant as a full-width list, with a pager across the four ----
  if (focus) {
    const m = meta(focus)
    return (
      <section aria-label={`${m.label} tasks`} className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5 px-1">
          <button
            type="button"
            onClick={() => setFocus(null)}
            aria-label="Back to quadrant overview"
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-card text-lg text-ink transition-colors hover:bg-bg"
          >
            ‹
          </button>
          <h2 className="font-serif text-xl font-semibold" style={{ color: m.color }}>
            {m.label}
          </h2>
          <span className="text-sm text-muted">
            {buckets[focus].count} {buckets[focus].count === 1 ? 'task' : 'tasks'}
          </span>
        </div>

        <nav
          aria-label="Quadrants"
          className="flex gap-1 rounded-xl border border-border bg-panel p-1"
        >
          {QUADRANT_ORDER.map((key) => {
            const isActive = key === focus
            const km = meta(key)
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFocus(key)}
                aria-current={isActive ? 'page' : undefined}
                className={
                  'flex flex-1 flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-semibold transition-colors ' +
                  (isActive ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')
                }
              >
                <span className="leading-none">{km.label}</span>
                <span
                  aria-hidden
                  className="inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white"
                  style={{ background: isActive ? km.color : '#9a9080' }}
                >
                  {buckets[key].count}
                </span>
              </button>
            )
          })}
        </nav>

        <ListView quadrantFilter={focus} onMoveToQuadrant={setMoveTask} />

        <button type="button" onClick={() => setAdding(true)} className={addButtonClass}>
          <span aria-hidden className="text-base leading-none">
            +
          </span>
          Add to {m.label}
        </button>
        {moveSheet}
        {addSheet}
      </section>
    )
  }

  // ---- OVERVIEW: the read-only 2×2 minimap ----
  return (
    <section aria-label="Quadrant overview" className={shell}>
      <div className="grid grid-cols-2 gap-2.5">
        {QUADRANT_ORDER.map((key) => {
          const m = meta(key)
          const { count, dominant } = buckets[key]
          const density = maxCount > 0 ? (count / maxCount) * 100 : 0
          const empty = count === 0
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFocus(key)}
              aria-label={`${m.label}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
              className={
                'flex min-h-[112px] flex-col gap-2 rounded-2xl border border-border-strong p-3 text-left transition-transform active:scale-[0.98] ' +
                (empty ? 'opacity-60' : '')
              }
              style={{ borderLeft: `4px solid ${m.color}`, background: QUADRANT_TINT[key] }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-serif text-[15px] font-semibold" style={{ color: m.color }}>
                  {m.label}
                </span>
                <span
                  aria-hidden
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none text-white"
                  style={{ background: m.color }}
                >
                  {count}
                </span>
              </div>
              <span className="text-[10px] text-muted-light">{QUADRANT_SUBTITLE[key]}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${density}%`, background: m.color, opacity: 0.7 }}
                />
              </div>
              <span className="mt-auto line-clamp-2 text-[11.5px] text-ink">
                {dominant ? (
                  dominant.text
                ) : (
                  <span className="text-muted-light">Nothing here yet</span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <button type="button" onClick={() => setAdding(true)} className={`mt-2.5 ${addButtonClass}`}>
        <span aria-hidden className="text-base leading-none">
          +
        </span>
        Add task
      </button>
      {addSheet}
    </section>
  )
}
