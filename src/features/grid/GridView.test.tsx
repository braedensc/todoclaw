import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { useGrid } from './use-grid'
import { GridSurface } from './GridSurface'
import { NewItemStrip } from '../shell/NewItemStrip'
import { ConfirmProvider } from '../../components/use-confirm'

// The grid was split (B8): the drag/placement orchestration lives in `useGrid`, the canvas render
// in `GridSurface`, and the not-yet-placed "new item" cards (card-in-place, B2 — replacing the old
// staging tray) in `NewItemStrip`, which lives in the input widget above the grid. This harness
// wires them back together exactly as WorkArea does, so these behavioural tests exercise the same
// integration.
function GridHarness() {
  const gridRef = useRef<HTMLDivElement>(null)
  const grid = useGrid(gridRef)
  // GridSurface calls useConfirm (its delete is now confirm-gated, B9), so the tree needs a real
  // <ConfirmProvider> — the same provider App mounts at the root, which also hosts the dialog.
  return (
    <ConfirmProvider>
      {grid.pendingTasks.length > 0 && (
        <NewItemStrip pending={grid.pendingTasks} grid={grid} canPlace />
      )}
      <GridSurface
        grid={grid}
        gridRef={gridRef}
        view="grid"
        onSelectView={() => {}}
        gridOnly={false}
        onExitGridOnly={() => {}}
      />
    </ConfirmProvider>
  )
}

// Mock the data layer so the grid renders under jsdom with no Supabase/network. Mutations are
// spies we assert against; the schedule/daily-state hooks return fixtures the tests override.
const updateMutate = vi.fn()
const softDeleteMutate = vi.fn()
const markDoneMutate = vi.fn()
let tasksFixture: Task[] = []
let doneTodayFixture: Record<string, boolean> = {}

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksFixture }),
  useUpdateTask: () => ({ mutate: updateMutate }),
  useSoftDeleteTask: () => ({ mutate: softDeleteMutate }),
}))
vi.mock('../done/use-history', () => ({
  useMarkTaskDone: () => ({ mutate: markDoneMutate }),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'America/New_York' } }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => ({
    data: { done: doneTodayFixture, done_at: {}, habit_done: {}, subtask_done: {} },
  }),
}))
const upsertReminderMutate = vi.fn()
vi.mock('../reminders/use-task-reminders', () => ({
  useTaskReminders: () => ({ data: new Map() }),
  useUpsertTaskReminder: () => ({ mutate: upsertReminderMutate }),
}))

// Build a Task with sane defaults; override per test.
function makeTask(over: Partial<Task>): Task {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    user_id: 'u1',
    text: 'A task',
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    // Fresh by construction: derived from the SAME real clock GridCard's stalenessStyle reads (it
    // injects no `now`), so a default card stays well under the 21-day staleness floor and never
    // silently crosses a tier as real time passes. A fixed date here would rot — e.g. a
    // '2026-06-23' default turns stale on 2026-07-14. Staleness-specific tests override created_at
    // with a fixed far-past date (e.g. '2000-01-01') to assert the faded style deterministically.
    created_at: new Date(Date.now() - 86_400_000).toISOString(), // ~1 day ago
    deleted_at: null,
    ...over,
  }
}

beforeEach(() => {
  updateMutate.mockClear()
  softDeleteMutate.mockClear()
  markDoneMutate.mockClear()
  tasksFixture = []
  doneTodayFixture = {}
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GridView placement filter', () => {
  it('renders placed (non-staged) cards and hides staged ones', () => {
    tasksFixture = [
      makeTask({ id: 'placed', text: 'On the grid', staged: false }),
      makeTask({ id: 'staged', text: 'Not placed yet', staged: true }),
    ]
    render(<GridHarness />)

    const cards = screen.getAllByTestId('grid-card')
    expect(cards).toHaveLength(1)
    expect(within(cards[0]!).getByText('On the grid')).toBeInTheDocument()

    // The staged task shows as a draggable "new item" card in the widget, not on the grid.
    const newCards = screen.getAllByTestId('new-item-card')
    expect(newCards).toHaveLength(1)
    expect(within(newCards[0]!).getByText('Not placed yet')).toBeInTheDocument()
  })

  it('hides tasks marked done today', () => {
    tasksFixture = [makeTask({ id: 'done-task', text: 'Already done', staged: false })]
    doneTodayFixture = { 'done-task': true }
    render(<GridHarness />)

    expect(screen.queryByTestId('grid-card')).not.toBeInTheDocument()
    expect(
      screen.getByText('No tasks placed — add one above and drag it here.'),
    ).toBeInTheDocument()
  })

  it('hides recurring tasks whose status is "ok" but shows due/overdue ones', () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString() // 1 day ago
    tasksFixture = [
      makeTask({
        id: 'ok-rec',
        text: 'Not due yet',
        recurring: { frequencyDays: 30, lastDoneAt: recent, doneCount: 1 },
      }),
      makeTask({
        id: 'overdue-rec',
        text: 'Way overdue',
        recurring: { frequencyDays: 1, lastDoneAt: null, doneCount: 0 },
      }),
    ]
    render(<GridHarness />)

    expect(screen.queryByText('Not due yet')).not.toBeInTheDocument()
    expect(screen.getByText('Way overdue')).toBeInTheDocument()
  })

  it('renders no new-item cards when nothing is staged', () => {
    tasksFixture = [makeTask({ staged: false })]
    render(<GridHarness />)
    expect(screen.queryByTestId('new-item-card')).not.toBeInTheDocument()
  })
})

describe('GridView card visuals', () => {
  it('colors a non-recurring card top border by quadrant (Do Now = amber)', () => {
    tasksFixture = [makeTask({ id: 'donow', x: 0.8, y: 0.8 })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    // quadrantMeta(0.8,0.8) → Do Now #bf5e2a → rgb(191, 94, 42)
    expect(card.style.borderTopColor).toBe('rgb(191, 94, 42)')
  })

  it('colors a recurring card top border by recurring status (overdue = terracotta)', () => {
    tasksFixture = [
      makeTask({
        id: 'rec',
        x: 0.8,
        y: 0.8,
        recurring: { frequencyDays: 1, lastDoneAt: null, doneCount: 0 },
      }),
    ]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    // RC_COLOR.overdue #c2693f → rgb(194, 105, 63)
    expect(card.style.borderTopColor).toBe('rgb(194, 105, 63)')
  })

  it('positions a card with y inverted (high importance near the top)', () => {
    tasksFixture = [makeTask({ id: 'pos', x: 0.25, y: 0.75 })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    expect(card.style.left).toBe('25%')
    // screenY = 1 - y = 0.25
    expect(card.style.top).toBe('25%')
  })

  it('renders the N× recurring badge once doneCount >= 3', () => {
    const recent = new Date(Date.now() - 86_400_000).toISOString()
    tasksFixture = [
      makeTask({
        id: 'badge',
        recurring: { frequencyDays: 2, lastDoneAt: recent, doneCount: 4 },
      }),
    ]
    render(<GridHarness />)
    expect(screen.getByText('4×')).toBeInTheDocument()
  })

  // Visual urgency wired end-to-end onto the real card (the constant tiers themselves are pinned
  // in lib/visual-urgency.test.ts — here we only prove the card threads them onto the DOM node).
  it('shows the overdue chip + pulse + warm tint for a past-due non-recurring card', () => {
    tasksFixture = [makeTask({ id: 'od', text: 'Ship it', due: '2000-01-01', staged: false })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    expect(within(card).getByText(/^Overdue · \d+d$/)).toBeInTheDocument()
    // The overdue tier pulses and warms the card; the keyframes live in src/index.css.
    expect(card.style.animation).toContain('urgency-pulse')
    expect(card.style.background).toBe('rgb(255, 248, 243)') // #fff8f3
  })

  it('desaturates + fades a long-untouched (stale) card', () => {
    tasksFixture = [makeTask({ id: 'old', created_at: '2000-01-01T00:00:00.000Z', staged: false })]
    render(<GridHarness />)
    // > 75 days old → opacity 0.72 (see stalenessStyle).
    expect(screen.getByTestId('grid-card').style.opacity).toBe('0.72')
  })

  it('suppresses the urgency glow + due badge on a recurring card (it has its own status)', () => {
    tasksFixture = [
      makeTask({
        id: 'rec-od',
        due: '2000-01-01',
        recurring: { frequencyDays: 1, lastDoneAt: null, doneCount: 0 },
      }),
    ]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    expect(card.style.animation).toBe('')
    expect(within(card).queryByText('overdue')).not.toBeInTheDocument()
  })
})

describe('GridView card action bar', () => {
  it('shows a persistent OUTLINED "Done" pill (label + green border/text, not filled) plus ⋯/× on every card', () => {
    tasksFixture = [makeTask({ id: 'x', text: 'Do a thing', staged: false })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')

    // Primary affordance is a LABELLED pill (not an icon-only ✓) carrying the visible word "Done".
    const done = within(card).getByRole('button', { name: 'Mark done' })
    expect(done).toHaveTextContent('Done')
    // …styled as an OUTLINED green pill — green border + green text, deliberately NOT filled solid
    // (a solid green pill would misread as "already completed"). The hover wash is allowed.
    expect(done.className).toContain('border-primary')
    expect(done.className).toContain('text-primary')
    expect(done.className).not.toMatch(/(^|\s)bg-primary(\s|$)/) // no solid green fill

    // Secondary actions live in the same bar and are always present (no hover-reveal anymore).
    expect(within(card).getByRole('button', { name: 'Due date and recurring' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
  })

  it('delete soft-deletes only after the confirm dialog is accepted', async () => {
    tasksFixture = [makeTask({ id: 'del-me', text: 'delete me', staged: false })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Delete task'))
    // The app-themed confirm gate appears; nothing is deleted until it's accepted.
    const dialog = await screen.findByRole('dialog')
    expect(softDeleteMutate).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(softDeleteMutate).toHaveBeenCalledWith('del-me'))
  })

  it('double-clicking the text edits it inline and commits a rename on Enter', () => {
    tasksFixture = [makeTask({ id: 'edit-me', text: 'Old name', staged: false })]
    render(<GridHarness />)
    // No ✎ button anymore — the text itself is the edit trigger (owner's pick, batch-2 item 5).
    expect(screen.queryByLabelText('Edit task')).not.toBeInTheDocument()

    fireEvent.doubleClick(screen.getByText('Old name'))
    const input = screen.getByLabelText('Edit task') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'New name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateMutate).toHaveBeenCalledWith({ id: 'edit-me', patch: { text: 'New name' } })
  })
})

describe('GridView on-card ⋯ menu (due + recurring)', () => {
  it('opens the menu with the due picker + recurring controls', () => {
    tasksFixture = [makeTask({ id: 'm', staged: false })]
    render(<GridHarness />)
    // Closed by default.
    expect(screen.queryByLabelText('Due date')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    expect(screen.getByLabelText('Due date')).toBeInTheDocument()
    expect(screen.getByText('↻ Recurring')).toBeInTheDocument()
  })

  it('setting a due date writes `due` ONLY — it never repositions the card', () => {
    tasksFixture = [makeTask({ id: 'm', x: 0.3, y: 0.7, staged: false })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-01' } })

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'm',
      patch: { due: '2026-08-01', due_time: null },
    })
    // Parity: no patch may carry x/y (that would move a manually-placed card).
    const patches = updateMutate.mock.calls.map((c) => (c[0] as { patch: object }).patch)
    expect(patches.some((p) => 'x' in p || 'y' in p)).toBe(false)
  })

  it('due time: disabled until a date exists, writes both columns, cleared with the date', () => {
    tasksFixture = [makeTask({ id: 'm', x: 0.3, y: 0.7, staged: false })]
    const noDate = render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    expect(screen.getByLabelText('Due time')).toBeDisabled()
    noDate.unmount()

    tasksFixture = [makeTask({ id: 'm', x: 0.3, y: 0.7, staged: false, due: '2026-08-01' })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    const timeInput = screen.getByLabelText('Due time')
    expect(timeInput).toBeEnabled()
    fireEvent.change(timeInput, { target: { value: '15:00' } })
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'm',
      patch: { due: '2026-08-01', due_time: '15:00' },
    })

    // Clearing the date clears the time with it (the DB CHECK forbids a dangling time).
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    expect(updateMutate).toHaveBeenCalledWith({ id: 'm', patch: { due: null, due_time: null } })
  })

  it('setting recurring from the menu writes a fresh recurring object', () => {
    tasksFixture = [makeTask({ id: 'm', staged: false })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    fireEvent.change(screen.getByLabelText('Days between repeats'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'm',
      patch: { recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 } },
    })
  })
})

describe('GridView recurring indicator', () => {
  it('marks a recurring card with a ↻ corner chip and dashed accent side borders', () => {
    tasksFixture = [
      makeTask({ id: 'rec', recurring: { frequencyDays: 1, lastDoneAt: null, doneCount: 0 } }),
    ]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    // Dashed side/bottom borders read as "this repeats"; the top stays solid (status color).
    expect(card.style.borderRightStyle).toBe('dashed')
    expect(card.style.borderBottomStyle).toBe('dashed')
    expect(card.style.borderLeftStyle).toBe('dashed')
    expect(card.style.borderTopStyle).not.toBe('dashed')
    // A persistent ↻ corner chip, decoupled from the status badge.
    expect(within(card).getByTitle('Repeats')).toBeInTheDocument()
  })

  it('leaves a one-off card with solid sides and no ↻ corner chip', () => {
    tasksFixture = [makeTask({ id: 'oneoff', staged: false })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    expect(card.style.borderRightStyle).not.toBe('dashed')
    expect(within(card).queryByTitle('Repeats')).not.toBeInTheDocument()
  })
})

describe('GridView grid mark-done', () => {
  it('marks a normal card done via the Done data layer (writes history)', () => {
    tasksFixture = [makeTask({ id: 'norm', text: 'Buy milk', bucket: 'oneoff', staged: false })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Mark done'))
    expect(markDoneMutate).toHaveBeenCalledWith({
      taskId: 'norm',
      text: 'Buy milk',
      bucket: 'oneoff',
      timeZone: 'America/New_York',
    })
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('resets a recurring card cycle (patches recurring) instead of writing history', () => {
    tasksFixture = [
      makeTask({
        id: 'rec',
        text: 'Water plants',
        recurring: { frequencyDays: 3, lastDoneAt: null, doneCount: 2 },
      }),
    ]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Mark done (resets clock)'))
    expect(markDoneMutate).not.toHaveBeenCalled()
    expect(updateMutate).toHaveBeenCalledTimes(1)
    const call = updateMutate.mock.calls[0]![0] as {
      id: string
      patch: { recurring: { lastDoneAt: string | null; doneCount: number; frequencyDays: number } }
    }
    expect(call.id).toBe('rec')
    expect(call.patch.recurring.frequencyDays).toBe(3)
    expect(call.patch.recurring.doneCount).toBe(3) // 2 + 1
    expect(call.patch.recurring.lastDoneAt).not.toBeNull() // cycle reset to now
  })
})

describe('GridView clustering', () => {
  // Two tasks within CX (0.09) / CY (0.07) of each other → one bubble, not two cards.
  it('collapses overlapping placed tasks into a single bubble with the count', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridHarness />)

    const bubbles = screen.getAllByTestId('cluster-bubble')
    expect(bubbles).toHaveLength(1)
    expect(within(bubbles[0]!).getByText('2')).toBeInTheDocument()
    // The cards are hidden inside the cluster until the popup opens.
    expect(screen.queryByTestId('grid-card')).not.toBeInTheDocument()
  })

  it('renders non-overlapping tasks as individual cards (no bubble)', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Top left', x: 0.1, y: 0.9 }),
      makeTask({ id: 'b', text: 'Bottom right', x: 0.9, y: 0.1 }),
    ]
    render(<GridHarness />)

    expect(screen.getAllByTestId('grid-card')).toHaveLength(2)
    expect(screen.queryByTestId('cluster-bubble')).not.toBeInTheDocument()
  })

  it('opens a popup listing the clustered tasks when the bubble is clicked', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridHarness />)

    expect(screen.queryByTestId('cluster-popup')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))

    const popup = screen.getByTestId('cluster-popup')
    expect(within(popup).getByText('Clean kitchen')).toBeInTheDocument()
    expect(within(popup).getByText('Clean bedroom')).toBeInTheDocument()
    expect(within(popup).getByText('2 tasks here')).toBeInTheDocument()
  })

  it('marks a normal popup row done via the Done data layer', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', bucket: 'oneoff', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridHarness />)
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))

    const popup = screen.getByTestId('cluster-popup')
    const rowA = within(popup).getByText('Clean kitchen').closest('[data-task-id]') as HTMLElement
    fireEvent.click(within(rowA).getByLabelText('Mark done'))

    expect(markDoneMutate).toHaveBeenCalledWith({
      taskId: 'a',
      text: 'Clean kitchen',
      bucket: 'oneoff',
      timeZone: 'America/New_York',
    })
  })

  it('resets a recurring popup row cycle instead of writing history', () => {
    tasksFixture = [
      makeTask({
        id: 'rec',
        text: 'Water plants',
        x: 0.5,
        y: 0.5,
        recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 },
      }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridHarness />)
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))

    const popup = screen.getByTestId('cluster-popup')
    const recRow = within(popup).getByText('Water plants').closest('[data-task-id]') as HTMLElement
    // The shared bar labels a recurring row's Done "resets clock", same as a recurring grid card.
    fireEvent.click(within(recRow).getByLabelText('Mark done (resets clock)'))

    expect(markDoneMutate).not.toHaveBeenCalled()
    const call = updateMutate.mock.calls.find(
      (c) => (c[0] as { id: string }).id === 'rec',
    )?.[0] as { patch: { recurring: { doneCount: number } } }
    expect(call.patch.recurring.doneCount).toBe(1)
  })

  it('closes the popup when the grid background is clicked', () => {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridHarness />)
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))
    expect(screen.getByTestId('cluster-popup')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByTestId('grid-canvas'))
    expect(screen.queryByTestId('cluster-popup')).not.toBeInTheDocument()
  })
})

// Item 16: a plain TAP on a popup row opens it for inline editing; only a real DRAG tears the card
// out onto the grid. Delete is confirm-gated (B9). The popup itself is portaled to <body>.
describe('GridView cluster popup rework', () => {
  function openPopup() {
    tasksFixture = [
      makeTask({ id: 'a', text: 'Clean kitchen', x: 0.5, y: 0.5 }),
      makeTask({ id: 'b', text: 'Clean bedroom', x: 0.52, y: 0.51 }),
    ]
    render(<GridHarness />)
    fireEvent.click(screen.getByRole('button', { name: /tasks stacked here/ }))
    const popup = screen.getByTestId('cluster-popup')
    const rowA = within(popup).getByText('Clean kitchen').closest('[data-task-id]') as HTMLElement
    return { popup, rowA }
  }

  it('tapping a row (press + release, no move) opens inline editing and never tears it out', () => {
    const { popup, rowA } = openPopup()

    fireEvent.pointerDown(rowA, { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 })

    // The row swaps to an edit input; nothing was committed to the grid (no drag-out).
    expect(within(popup).getByLabelText('Edit task name')).toBeInstanceOf(HTMLInputElement)
    expect(updateMutate).not.toHaveBeenCalled()
    // The popup stays open while editing.
    expect(screen.getByTestId('cluster-popup')).toBeInTheDocument()
  })

  it('committing an inline rename (Enter) writes text only and never moves the card', () => {
    const { popup, rowA } = openPopup()
    fireEvent.pointerDown(rowA, { clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 })

    const input = within(popup).getByLabelText('Edit task name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Scrub kitchen' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateMutate).toHaveBeenCalledWith({ id: 'a', patch: { text: 'Scrub kitchen' } })
    const patches = updateMutate.mock.calls.map((c) => (c[0] as { patch: object }).patch)
    expect(patches.some((p) => 'x' in p || 'y' in p)).toBe(false)
  })

  it('each row carries the same action bar as a grid card (outlined Done pill + ⋯/×)', () => {
    const { rowA } = openPopup()

    // The primary affordance is the LABELLED outlined pill (not an icon-only ✓): visible "Done"
    // text, green border + green text, deliberately NOT filled solid — identical to the grid card.
    const done = within(rowA).getByRole('button', { name: 'Mark done' })
    expect(done).toHaveTextContent('Done')
    expect(done.className).toContain('border-primary')
    expect(done.className).toContain('text-primary')
    expect(done.className).not.toMatch(/(^|\s)bg-primary(\s|$)/)

    // Plus the same quiet ⋯ (menu/edit) + × (delete) pair on the right.
    expect(within(rowA).getByRole('button', { name: 'Edit task' })).toHaveTextContent('⋯')
    expect(within(rowA).getByRole('button', { name: 'Delete task' })).toHaveTextContent('×')
  })

  it('the ⋯ button also opens inline editing', () => {
    const { popup, rowA } = openPopup()
    fireEvent.click(within(rowA).getByLabelText('Edit task'))
    expect(within(popup).getByLabelText('Edit task name')).toBeInstanceOf(HTMLInputElement)
  })

  it('dragging a row past the threshold tears the task out onto the grid and closes the popup', () => {
    const { rowA } = openPopup()

    fireEvent.pointerDown(rowA, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 220, clientY: 180 }) // > 4px → a real drag
    fireEvent.pointerUp(window, { clientX: 220, clientY: 180 })

    // A real drag commits x/y (+ clears staged) — the tear-out — and closes the popup.
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', patch: expect.objectContaining({ staged: false }) }),
    )
    expect(screen.queryByTestId('cluster-popup')).not.toBeInTheDocument()
  })

  it('deleting a popup row confirms first, then soft-deletes', async () => {
    const { rowA } = openPopup()

    fireEvent.click(within(rowA).getByLabelText('Delete task'))
    // The app-themed confirm gate appears (distinct from the popup's own dialog role by its name).
    const dialog = await screen.findByRole('dialog', { name: /Delete/ })
    expect(softDeleteMutate).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(softDeleteMutate).toHaveBeenCalledWith('a'))
  })
})
