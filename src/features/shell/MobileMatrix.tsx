import { useState } from 'react'
import type { Task } from '../../types/task'
import { useTasks, useUpdateTask } from '../tasks/use-tasks'
import { useTimeZone } from '../schedule/use-time-zone'
import { useDailyState } from '../daily-state/use-daily-state'
import { useNow } from '../../hooks/use-now'
import { daysUntil } from '../../lib/scoring'
import { minutesUntilDueTime } from '../../lib/dates'
import { urgencyTier } from '../../lib/visual-urgency'
import { recurringDoneToday } from '../../lib/recurring'
import { isDormant } from '../../lib/start-date'
import { quadrantMeta, type QuadrantKey } from '../../lib/quadrants'
import {
  summarizeQuadrants,
  moveToQuadrant,
  QUADRANT_ORDER,
  QUADRANT_CENTER,
  QUADRANT_SUBTITLE,
} from '../../lib/quadrant-summary'
import { QUADRANT_TINT } from '../grid/grid-constants'
import { ListView } from '../list/ListView'
import { PausedSection } from '../tasks/PausedSection'
import { MoveToQuadrantSheet } from './MoveToQuadrantSheet'
import type { QuadrantFocus } from './use-quadrant-focus'

// MobileMatrix — the phone (< 720px) reinterpretation of the priority matrix (Concept C, ADR-0025).
// On mobile this is the ONLY task surface (no grid, no Grid/List toggle — ADR-0028): the two jobs
// the matrix does are split across two coordinated views — an OVERVIEW (a read-only 2×2 minimap of
// "what's the whole picture / what's on fire") and a FOCUS list (one quadrant as a comfortable
// full-width list — the existing ListView scoped by `quadrantFilter`).
//
// Rows keep every ListView interaction (complete / edit / delete / expand / recurring) plus a
// tap-based "Move to quadrant" picker (MoveToQuadrantSheet) — the no-drag reposition path. ADDING
// is owned by the bottom nav's "+" (MobileAddSheet at the app level), not here. Desktop never mounts
// this — WorkArea renders it only below the breakpoint (useIsMobile).

// Label + color for a quadrant, read from the canonical quadrantMeta at its band center.
function meta(key: QuadrantKey) {
  const c = QUADRANT_CENTER[key]
  return quadrantMeta(c.x, c.y)
}

const shell = 'rounded-xl border border-border-strong bg-panel p-4'

export function MobileMatrix({
  quadrantFocus,
  onSeeExample,
}: {
  quadrantFocus: QuadrantFocus
  /**
   * Open the example-day scene (DemoScene) — shown under a fully-empty overview, the moment a
   * confused new user is most likely staring at. Absent inside the demo scene itself.
   */
  onSeeExample?: () => void
}) {
  const { data: tasks, isLoading, isError } = useTasks()
  const timeZone = useTimeZone()
  const { data: daily } = useDailyState(timeZone)
  const updateTask = useUpdateTask()
  // One shared clock for the overview tiles' due badges (timed tasks flip to overdue when their
  // instant passes — same tier logic as every chip).
  const now = useNow()
  // Which quadrant is focused lives at the App level (use-quadrant-focus): Back pops it, and the
  // add sheet pre-selects it. This component just renders + drives it.
  const { focus } = quadrantFocus
  // The task whose quadrant is being changed via the tap picker (null = sheet closed).
  const [moveTask, setMoveTask] = useState<Task | null>(null)

  // Entering a focus list from an overview cell: the cell might be at the bottom of a scrolled
  // page — snap the app scroller back to the top so the focus header/pager land in view.
  const enterFocus = (key: QuadrantKey) => {
    quadrantFocus.enter(key)
    document.getElementById('root')?.scrollTo({ top: 0 })
  }

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

  // Completed tasks are excluded: a one-off completion is PERMANENT (task.completed_at, survives
  // the daily reset); today's done map is a same-day belt-and-suspenders hide. A recurring task
  // marked done today is also hidden for the rest of the local day (recurringDoneToday) — it never
  // sets completed_at, so without this a just-completed chore lingers in the quadrant preview and
  // "done" reads as a no-op; it returns the next day. Mirrors the grid's isPlaced.
  const doneToday = daily?.done ?? {}
  const active = tasks.filter(
    (t) =>
      !t.completed_at &&
      !doneToday[t.id] &&
      !recurringDoneToday(t.recurring, timeZone) &&
      // Dormant (paused / future start date): out of the quadrants and counts; the Paused strip
      // below the overview is its mobile home until the start date arrives.
      !isDormant(t, timeZone),
  )
  const paused = tasks.filter((t) => !t.completed_at && isDormant(t, timeZone))
  const { buckets } = summarizeQuadrants(active, { timeZone })

  // Per-quadrant "on fire" counts for the overview badges: due today (incl. the final hours)
  // and overdue. Recurring tasks are excluded — their cadence badge is a different system.
  const dueCounts = (key: QuadrantKey): { today: number; overdue: number } => {
    let today = 0
    let overdue = 0
    for (const t of active) {
      if (t.recurring || quadrantMeta(t.x ?? 0.5, t.y ?? 0.5).key !== key) continue
      const tier = urgencyTier(
        daysUntil(t.due, { timeZone }),
        minutesUntilDueTime(t.due, t.due_time, timeZone, now),
      )
      if (tier === 'overdue') overdue += 1
      else if (tier === 'today' || tier === 'final-hours') today += 1
    }
    return { today, overdue }
  }

  // Commit a tap-picker move: snap to the chosen quadrant's center, collision-resolve against all
  // active tasks, write the coords, and close the sheet. Same coord path as a list-slider commit.
  const handleMove = (dest: QuadrantKey) => {
    if (!moveTask) return
    const { x, y } = moveToQuadrant(moveTask, dest, active)
    updateTask.mutate({ id: moveTask.id, patch: { x, y } })
    setMoveTask(null)
  }

  // The move picker — shared across overview/focus; open while a task is selected.
  const moveSheet = (
    <MoveToQuadrantSheet
      task={moveTask}
      currentKey={moveTask ? quadrantMeta(moveTask.x ?? 0.5, moveTask.y ?? 0.5).key : null}
      onPick={handleMove}
      onClose={() => setMoveTask(null)}
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
            onClick={quadrantFocus.exit}
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
                onClick={() => quadrantFocus.switchTo(key)}
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
        {moveSheet}
      </section>
    )
  }

  // ---- OVERVIEW: the read-only 2×2 minimap ----
  return (
    <>
      <section aria-label="Quadrant overview" data-tour="matrix" className={shell}>
        <div className="grid grid-cols-2 gap-2.5">
          {QUADRANT_ORDER.map((key) => {
            const m = meta(key)
            const { count, top } = buckets[key]
            const empty = count === 0
            const due = dueCounts(key)
            const dueBadge = [
              due.today > 0 ? `${due.today} today` : null,
              due.overdue > 0 ? `${due.overdue} overdue` : null,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={key}
                type="button"
                onClick={() => enterFocus(key)}
                aria-label={`${m.label}, ${count} ${count === 1 ? 'task' : 'tasks'}`}
                className={
                  'flex min-h-[128px] flex-col gap-2 rounded-2xl border border-border-strong p-3 text-left transition-transform active:scale-[0.98] ' +
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
                <span className="text-[11px] text-muted-light">{QUADRANT_SUBTITLE[key]}</span>
                {/* Due-urgency badge — the mobile stand-in for the grid's glow: what's on fire in
                  this quadrant, at a glance from the overview. */}
                {dueBadge && (
                  <span
                    className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ color: '#c2693f', backgroundColor: 'rgba(194,105,63,0.10)' }}
                  >
                    <span aria-hidden>⏰</span>
                    {dueBadge}
                  </span>
                )}
                {/* Preview the top few tasks (score-ranked) instead of an ambiguous density bar. */}
                {empty ? (
                  <span className="mt-0.5 text-[11.5px] text-muted-light">Nothing here yet</span>
                ) : (
                  <ul className="mt-0.5 flex flex-col gap-1">
                    {top.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center gap-1.5 text-[11.5px] leading-tight text-ink"
                      >
                        <span
                          aria-hidden
                          className="h-1 w-1 shrink-0 rounded-full"
                          style={{ background: m.color }}
                        />
                        <span className="truncate">{t.text}</span>
                      </li>
                    ))}
                    {count > top.length && (
                      <li className="text-[11px] text-muted-light">+{count - top.length} more</li>
                    )}
                  </ul>
                )}
              </button>
            )
          })}
        </div>
        {/* A fully-empty board: offer the example-day peek right where the new user is looking. */}
        {active.length === 0 && onSeeExample && (
          <button
            type="button"
            onClick={onSeeExample}
            className="mt-2.5 w-full rounded-full border border-border-strong bg-card py-2.5 text-[13px] font-medium text-ink transition-colors active:scale-[0.99]"
          >
            <span aria-hidden>👀</span> See an example board
          </button>
        )}
      </section>
      {/* Paused (dormant) tasks — their only mobile surface; Resume wakes one immediately. */}
      <PausedSection
        tasks={paused}
        onResume={(id) => updateTask.mutate({ id, patch: { start_date: null } })}
      />
    </>
  )
}
