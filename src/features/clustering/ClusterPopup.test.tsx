import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
    created_at: '2026-07-01T00:00:00Z',
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
