import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

// The row ⋯ mounts SchedulePanel, which now reaches useLogWork -> lib/supabase. That module THROWS
// at import time without the VITE_SUPABASE_* env vars, so an untouched CI runner fails the whole
// file before a single test runs (it passes locally only because a dev .env.local is loaded).
// Stub the client, exactly as every other supabase-adjacent component test does.
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

import { ClusterPopup } from './ClusterPopup'
import type { Task } from '../../types/task'
import type { Recurring } from '../../types/task'

// The row ⋯ mounts the SchedulePanel, whose DueTimezoneHint reads the user_schedule query —
// stub it out (the popup's own logic never touches it).
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: undefined }),
}))

// A folded task inside an open cluster popup is dressed as its grid-card TWIN: an overdue/near-due
// one-off carries the SAME glow ring + pulse + warm tint as the card on the map, while a task with
// no due date — or a recurring one (which owns its status color + dashed accent borders) — stays on
// the plain paper fill. The panel behind the rows is white so each card's color reads as its own.

// Created "yesterday", computed at run time: an UNDATED task flips to the ❄️ stale lane (icy
// tint + azure ring, lib/visual-urgency staleness) once it has sat 90 days on the board, and the
// popup reads the REAL clock. A hardcoded created_at ages across that flip and quietly re-tints
// the undated 'plain' row this suite asserts stays plain.
const FRESH_CREATED_AT = new Date(Date.now() - 86_400_000).toISOString()

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    user_id: 'u1',
    text: `Task ${id}`,
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    worked_days: null,
    created_at: FRESH_CREATED_AT,
    deleted_at: null,
    completed_at: null,
    start_date: null,
    ...over,
  }
}

const recurring: Recurring = { frequencyDays: 7, lastDoneAt: null, doneCount: 0 }

// Always exactly 2 days past due, computed at run time (the popup evaluates in timeZone="UTC",
// matching toISOString): solidly OVERDUE — the hot 🔥 tier — but never able to age across the
// 21-days-past-due ❄️-stale flip (lib/visual-urgency staleness), which silently strips the pulse
// and re-tints the row. A hardcoded past date rotted exactly that way once real time caught up.
const OVERDUE_DUE = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)

function renderPopup(group: Task[], onRowPointerDown: () => () => void = () => vi.fn()) {
  // A real, MOUNTED anchor: the popup positions from its rect in an effect and stays
  // `visibility: hidden` (excluded from the a11y tree) until that first measure lands.
  const anchorRef = createRef<HTMLDivElement>()
  const schedule = {
    onSetDue: vi.fn(),
    onSetRecurring: vi.fn(),
    onSetFrequency: vi.fn(),
    onRemoveRecurring: vi.fn(),
    onSetOngoing: vi.fn(),
    onSetStartDate: vi.fn(),
    onToggleReminder: vi.fn(),
    onClearReminders: vi.fn(),
  }
  render(
    <>
      <div ref={anchorRef} />
      <ClusterPopup
        group={group}
        accentColor="#bf5e2a"
        anchorRef={anchorRef}
        reflowKey={0}
        timeZone="UTC"
        editingId={null}
        onStopEdit={vi.fn()}
        onRename={vi.fn()}
        onDone={vi.fn()}
        onDelete={vi.fn()}
        onRowPointerDown={onRowPointerDown}
        reminderOffsetsFor={() => []}
        {...schedule}
      />
    </>,
  )
  // Portaled to <body>, so query the document rather than the render container.
  const row = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid="cluster-popup-row"][data-task-id="${id}"]`)
  return { row, ...schedule }
}

describe('ClusterPopup row card-twin styling', () => {
  it('gives an overdue one-off row the full card treatment; an undated row stays plain', () => {
    const { row } = renderPopup([task('over', { due: OVERDUE_DUE }), task('plain')])
    const over = row('over')
    // Ring + pulse + warm tint — the same three channels a standalone grid card gets.
    expect(over?.style.background).toBeTruthy()
    expect(over?.style.boxShadow).toBeTruthy()
    expect(over?.style.animation).toContain('urgency-pulse')
    // Color-independent 🔥 corner flag on the hot tiers.
    expect(over?.querySelector('[title="Overdue"]')?.textContent).toBe('🔥')
    const plain = row('plain')
    expect(plain?.style.background).toBe('')
    expect(plain?.style.animation).toBe('')
    expect(plain?.querySelector('[title="Overdue"]')).toBeNull()
  })

  it('borders every row like its grid card: status top border + accent sides', () => {
    const { row } = renderPopup([task('over', { due: OVERDUE_DUE })])
    const style = row('over')?.style
    expect(style?.borderTopWidth).toBe('3px')
    expect(style?.borderTopColor).toBeTruthy() // quadrant color for a one-off
    expect(style?.borderRightColor).toBe('rgb(194, 105, 63)') // BUCKET_DOT terracotta sides
  })

  it('keeps a recurring row on plain paper with dashed accent sides (its own status color)', () => {
    // Even overdue-on-cadence, a recurring task takes no urgency tier here.
    const { row } = renderPopup([task('rec', { due: OVERDUE_DUE, recurring })])
    const rec = row('rec')
    expect(rec?.style.background).toBe('')
    expect(rec?.style.borderRightStyle).toBe('dashed')
    expect(rec?.querySelector('[title="Overdue"]')).toBeNull()
  })

  it('renders the panel white so each card color reads as its own', () => {
    renderPopup([task('a')])
    const panel = document.querySelector('[data-testid="cluster-popup"]')
    expect(panel?.className).toContain('bg-white')
  })
})

// A folded ONGOING project has no ∞ marker in the row's chip lane, so the meta line is what
// explains why its ✓ says "Worked" — and the pill fills once today's session is banked.
describe('ClusterPopup ongoing rows', () => {
  const WORKED_3D_AGO = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10)
  const TODAY = new Date().toISOString().slice(0, 10)

  it('reads the session log back on the row and labels the ✓ "Worked"', () => {
    const { row } = renderPopup([task('og', { ongoing: true, worked_days: [WORKED_3D_AGO] })])
    expect(row('og')?.textContent).toContain('ongoing · Last worked 3 days ago')
    expect(
      screen.getByRole('button', { name: 'Log that you worked on this today' }),
    ).toHaveTextContent('Worked')
  })

  it('fills the ✓ once today is logged (tapping again undoes it)', () => {
    renderPopup([task('og', { ongoing: true, worked_days: [TODAY] })])
    const worked = screen.getByRole('button', { name: 'Worked on this today — click to undo' })
    // Visible label is stable across both states (see doneControlCopy); the fill and aria-pressed
    // carry "today" so the pill can't grow and reflow the row.
    expect(worked).toHaveTextContent('Worked')
    expect(worked).toHaveAttribute('aria-pressed', 'true')
  })
})

// Dormant tasks cluster like any card (2026-08-20), so a folded PAUSED row is an everyday state:
// it must keep the standalone paused card's full slate dress inside the popup.
describe('ClusterPopup paused rows', () => {
  // Now-relative so the fixture can't rot across the daily boundary — a month out is firmly future.
  const FUTURE_START = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  it('a folded paused task keeps the slate ⏸ dress: chip, ring, tint, dim, 💤 flag', () => {
    const { row } = renderPopup([
      // Even with an overdue due date, the paused lane gates the warm dress (deadline deferred).
      task('zzz', { start_date: FUTURE_START, due: OVERDUE_DUE }),
      task('live'),
    ])
    const paused = row('zzz')!
    expect(paused.textContent).toContain('⏸ starts')
    expect(paused.textContent).not.toContain('Overdue')
    expect(paused.style.animation).toBe('') // no urgency pulse while asleep
    // Slate ring + slate tint + whole-row dim — the same dress its standalone card wears.
    expect(paused.style.boxShadow).toContain('rgba(100,116,139,1)')
    expect(paused.style.background).toBe('rgb(231, 235, 242)') // #e7ebf2
    expect(parseFloat(paused.style.opacity)).toBeLessThan(1)
    // The 💤 corner flag (title spelled out, shared with the chip).
    expect(
      [...paused.querySelectorAll('[title^="Paused"]')].some((el) => el.textContent === '💤'),
    ).toBe(true)
    // The live row stays undimmed on plain paper.
    const live = row('live')!
    expect(live.style.opacity).toBe('')
    expect(live.style.background).toBe('')
    // The Done pill stays on a paused row — the popup row is the desktop grid card's twin, and a
    // paused GridCard keeps its Done pill too (unlike the touch sheet/popover's paused mode).
    // Pinned so the two surfaces can't drift apart silently in either direction.
    expect(
      [...paused.querySelectorAll('button')].some((b) => b.textContent?.includes('Done')),
    ).toBe(true)
  })

  it('a paused CHORE row leads with the ⏸ chip, not its ↻ marker (paused gates first)', () => {
    const { row } = renderPopup([
      task('pzc', {
        start_date: FUTURE_START,
        recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
      }),
    ])
    const r = row('pzc')!
    // Same chip precedence as the touch chip/sheet: the slate ⏸ outranks the recurring marker.
    expect(r.textContent).toContain('⏸ starts')
    expect(r.querySelector('[title="never done"]')).toBeNull() // no ↻ status chip in the slot
    // The dashed recurring border stays — the chip slot is what paused claims.
    expect(r.style.borderRightStyle).toBe('dashed')
  })
})

describe('ClusterPopup row ⋯ schedule menu', () => {
  it('the row ⋯ opens the shared SchedulePanel (a folded task is schedulable in place)', () => {
    renderPopup([task('a')])
    expect(screen.queryByTestId('schedule-calendar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Due date and recurring' }))
    expect(screen.getByText('Set a due date')).toBeInTheDocument()
    expect(screen.getByTestId('schedule-calendar')).toBeInTheDocument()
  })

  it('panel writes route to the row task: Recurring starts a fresh schedule, No date clears due', () => {
    const p = renderPopup([task('a', { due: OVERDUE_DUE })])
    fireEvent.click(screen.getByRole('button', { name: 'Due date and recurring' }))

    // The type switch's "Recurring" seeds a fresh weekly schedule on THIS row.
    fireEvent.click(screen.getByRole('button', { name: 'Recurring' }))
    expect(p.onSetRecurring).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 7)

    fireEvent.click(screen.getByRole('button', { name: 'No date' }))
    expect(p.onSetDue).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), null, null)
  })

  it('a pointer-down inside the panel never reaches the row (no accidental tear-out drag)', () => {
    const rowPointerDown = vi.fn()
    renderPopup([task('a')], () => rowPointerDown)
    fireEvent.click(screen.getByRole('button', { name: 'Due date and recurring' }))
    fireEvent.pointerDown(screen.getByTestId('schedule-calendar'))
    expect(rowPointerDown).not.toHaveBeenCalled()
  })
})
