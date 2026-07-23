import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { useGrid } from './use-grid'
import { GridSurface } from './GridSurface'
import { NewItemStrip } from '../shell/NewItemStrip'
import { ConfirmProvider } from '../../components/use-confirm'
import { BACKGROUND_DISMISS_ATTR } from '../../hooks/use-background-dismiss'

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
  // Due writes go through the shared setDue hook's mutateAsync; forwarding it to the same spy
  // keeps every write-path assertion on the one updateMutate ledger.
  useUpdateTask: () => ({
    mutate: updateMutate,
    mutateAsync: async (vars: unknown) => updateMutate(vars),
  }),
  useSoftDeleteTask: () => ({ mutate: softDeleteMutate }),
}))
vi.mock('../done/use-history', () => ({
  useMarkTaskDone: () => ({ mutate: markDoneMutate }),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'America/New_York', config: {} } }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => ({
    data: { done: doneTodayFixture, done_at: {}, habit_done: {}, subtask_done: {} },
  }),
}))
const reminderAdd = vi.fn()
vi.mock('../reminders/use-task-reminders', () => ({
  useTaskReminders: () => ({ data: new Map() }),
  useTaskReminderWrites: () => ({
    add: reminderAdd,
    remove: vi.fn(),
    clear: vi.fn(),
    toggle: vi.fn(),
  }),
}))
// The iPad hybrid flips on this capability (hold-to-lift reposition + tap → actions popover).
// Default false so every pre-existing test exercises the untouched fine-pointer paths.
const mockIsCoarse = vi.fn(() => false)
vi.mock('../../hooks/use-is-coarse-pointer', () => ({
  useIsCoarsePointer: () => mockIsCoarse(),
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
    ongoing: false,
    // Fresh by construction: derived from the SAME real clock GridCard's staleness check reads
    // (it injects no `now`), so a default undated card stays well under the 90-day stale floor
    // and never silently crosses a tier as real time passes. A fixed date here would rot.
    // Stale-specific tests override created_at with a fixed far-past date (e.g. '2000-01-01'),
    // or set a due date weeks in the past, to assert the cool dress deterministically.
    created_at: new Date(Date.now() - 86_400_000).toISOString(), // ~1 day ago
    deleted_at: null,
    completed_at: null,
    start_date: null,
    ...over,
  }
}

beforeEach(() => {
  updateMutate.mockClear()
  softDeleteMutate.mockClear()
  markDoneMutate.mockClear()
  // vi.clearAllMocks() in afterEach wipes implementations too — re-arm the capability default.
  mockIsCoarse.mockReturnValue(false)
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

  it('hides a completed still-staged task from the new-item strip (the ghost-item bug)', () => {
    // Regression: a one-off task marked done while still UNPLACED keeps staged=true and gets
    // completed_at stamped. It correctly leaves the list, but pendingTasks used to filter on
    // `staged` ONLY — so it reappeared as a draggable "new item" card and, because staged never
    // resets, survived the daily reset. This is the fifth render surface PR #191's completed_at
    // hide missed. With doneToday empty (the next-day case) the completed staged task must NOT
    // render, while a genuinely-new staged task still does.
    tasksFixture = [
      makeTask({
        id: 'ghost',
        text: 'Done but unplaced',
        staged: true,
        completed_at: '2026-06-23T12:00:00Z',
      }),
      makeTask({ id: 'fresh', text: 'Genuinely new', staged: true }),
    ]
    doneTodayFixture = {}
    render(<GridHarness />)

    const newCards = screen.getAllByTestId('new-item-card')
    expect(newCards).toHaveLength(1)
    expect(within(newCards[0]!).getByText('Genuinely new')).toBeInTheDocument()
    expect(screen.queryByText('Done but unplaced')).not.toBeInTheDocument()
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

  it('hides completed tasks even when today’s daily state is empty (the next-day case)', () => {
    // Regression for tasks reappearing on the grid after a daily reset: a one-off completion used
    // to be tracked only in today's daily_state.done map, so a fresh (empty) day put the card
    // back. task.completed_at makes the hide permanent — with doneTodayFixture empty (simulating
    // the next day) a completed card must stay off the grid.
    tasksFixture = [
      makeTask({ id: 'done-task', text: 'Already done', completed_at: '2026-06-23T12:00:00Z' }),
    ]
    doneTodayFixture = {}
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

  it('hides a short-cadence recurring task the day it was marked done, shows it again after', () => {
    // Regression: hiding recurring tasks only at status "ok" (daysLeft > 5) meant a ≤5-day chore
    // re-read as due/soon the instant it was marked done and never left the grid — "done" looked
    // like a no-op. A recurring task done TODAY is now hidden for the rest of the local day; a
    // task done on a PRIOR day (the next-day case) shows again per its cadence.
    const now = new Date().toISOString() // done today
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString() // a prior local day
    tasksFixture = [
      makeTask({
        id: 'just-done',
        text: 'Water the plants',
        recurring: { frequencyDays: 2, lastDoneAt: now, doneCount: 3 },
      }),
      makeTask({
        id: 'due-again',
        text: 'Take out trash',
        recurring: { frequencyDays: 2, lastDoneAt: twoDaysAgo, doneCount: 1 },
      }),
    ]
    render(<GridHarness />)

    expect(screen.queryByText('Water the plants')).not.toBeInTheDocument()
    expect(screen.getByText('Take out trash')).toBeInTheDocument()
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
  it('shows the overdue chip + pulse + warm tint + 🔥 flag for a recently past-due card', () => {
    // ~2 days past due (real clock; the UTC date-slice may read as 1 day in America/New_York) —
    // firmly overdue but well under the 21-day stale floor, so the HOT dress owns the card.
    const due = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    tasksFixture = [makeTask({ id: 'od', text: 'Ship it', due, staged: false })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    expect(within(card).getByText(/^Overdue · \d+d$/)).toBeInTheDocument()
    // The overdue tier pulses and warms the card; the keyframes live in src/index.css.
    expect(card.style.animation).toContain('urgency-pulse')
    expect(card.style.background).toBe('rgb(255, 241, 232)') // #fff1e8
    // …and the color-independent 🔥 corner flag threads onto the DOM (urgencyIcon).
    expect(within(card).getByTitle('Overdue')).toHaveTextContent('🔥')
  })

  it('cools a LONG-ignored overdue card: ❄️ replaces the 🔥, "Stale · Nw" replaces the overdue chip', () => {
    // ~60 days past due → 3+ weeks past the stale floor: the whole hot dress flips to the cool one.
    const due = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)
    tasksFixture = [makeTask({ id: 'ignored', text: 'Someday maybe', due, staged: false })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    // The hot dress is GONE: no pulse, no 🔥, no terracotta "Overdue · Nd" chip.
    expect(card.style.animation).toBe('')
    expect(within(card).queryByTitle('Overdue')).not.toBeInTheDocument()
    expect(within(card).queryByText(/^Overdue/)).not.toBeInTheDocument()
    // In its place, the cool one: the ❄️ corner flag — the chip carries the same spelled-out
    // title, so query for the flag as the ❄️-only element among them…
    const staleBits = within(card).getAllByTitle(/^Stale — \d+w past due$/)
    expect(staleBits.some((el) => el.textContent === '❄️')).toBe(true)
    // …the azure "Stale · Nw" chip, and the mid-depth cool ring + icy tint (60d ≈ 2.9× the floor).
    expect(within(card).getByText(/^❄️ Stale · \d+w$/)).toBeInTheDocument()
    expect(card.style.boxShadow).toContain('rgba(50,118,205,0.78)')
    expect(card.style.background).toBe('rgb(234, 243, 252)') // #eaf3fc
  })

  it('cools an undated card only after months on the board (a long-term idea, not ignored)', () => {
    tasksFixture = [makeTask({ id: 'old', created_at: '2000-01-01T00:00:00.000Z', staged: false })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    // Decades past the 90-day undated floor → the deepest cool-blue stale ring threads onto the
    // card (see staleRingStyle), plus the iciest tint — and the ❄️ badge says how long it's sat.
    expect(card.style.boxShadow).toContain('rgba(50,118,205,0.95)')
    expect(card.style.background).toBe('rgb(224, 237, 251)') // #e0edfb
    expect(within(card).getByText(/^❄️ Stale · \d+y$/)).toBeInTheDocument()
    const staleBits = within(card).getAllByTitle(/^Stale — \d+y on the board$/)
    expect(staleBits.some((el) => el.textContent === '❄️')).toBe(true)
    // The retired fade stays gone: full opacity, no desaturating filter.
    expect(card.style.opacity).toBe('')
    expect(card.style.filter).toBe('')
  })

  it('keeps a fresh undated card clean — no ring, no ❄️ (staleness needs months, not weeks)', () => {
    // 30 days old: past the OLD created-age floor (21d) but far under the undated stale floor.
    const created_at = new Date(Date.now() - 30 * 86_400_000).toISOString()
    tasksFixture = [makeTask({ id: 'idea', created_at, staged: false })]
    render(<GridHarness />)
    const card = screen.getByTestId('grid-card')
    expect(card.style.boxShadow).toBe('')
    expect(within(card).queryByText(/Stale/)).not.toBeInTheDocument()
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

// A dormant task (future start_date) is hidden from the ACTIVE board but still rendered as its own
// read-only "set aside" pass: a paused card at its stored x/y, dimmed with the ⏸ slate chip, out of
// the clustering / drag machinery. (isPlaced excludes dormant; useGrid.dormantPlaced re-adds them.)
describe('GridView paused (dormant) cards', () => {
  // Now-relative so the fixture can't rot across the daily boundary — a month out is firmly future.
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  it('renders a dormant placed task as a read-only, dimmed card with the ⏸ paused chip', () => {
    tasksFixture = [
      makeTask({ id: 'zzz', text: 'Book the venue', x: 0.3, y: 0.7, start_date: future }),
    ]
    render(<GridHarness />)

    const card = screen.getByTestId('grid-card')
    expect(within(card).getByText('Book the venue')).toBeInTheDocument()
    // The ⏸ slate chip says when it comes back (formatStartDay day), not a due date.
    expect(within(card).getByText(/^⏸ starts /)).toBeInTheDocument()
    // The 💤 corner flag — the paused member of the 🔥/❄️ family. It shares its spelled-out title
    // with the chip, so query for the flag as the 💤-only element among them (stale-test pattern).
    const sleepBits = within(card).getAllByTitle(/^Paused — starts /)
    expect(sleepBits.some((el) => el.textContent === '💤')).toBe(true)
    // The slate dress threads onto the node: full-alpha slate ring + slate tint (#e7ebf2).
    expect(card.style.boxShadow).toContain('rgba(100,116,139,1)')
    expect(card.style.background).toBe('rgb(231, 235, 242)')
    // Read-only: flagged for E2E/style hooks, and NO grab cursor (can't be dragged).
    expect(card).toHaveAttribute('data-paused')
    expect(card.className).not.toContain('cursor-grab')
    // Dimmed whole (set-aside cue), but still legible.
    expect(card.style.opacity).not.toBe('')
    expect(parseFloat(card.style.opacity)).toBeLessThan(1)
    // The empty-state is gated on BOTH lists: a board with only a paused card is not "empty".
    expect(screen.queryByText('No tasks placed — add one above and drag it here.')).toBeNull()
    // …and the legend below the grid decodes the lane (slate swatch + the 💤 note).
    const legend = screen.getByTestId('urgency-legend')
    expect(within(legend).getByText('paused (dimmed)')).toBeInTheDocument()
    expect(within(legend).getByText(/asleep until its start date/)).toBeInTheDocument()
  })

  it('suppresses the due chip on a paused card — its deadline is intentionally deferred', () => {
    // Even an overdue due date shows NO warm chip while paused (the paused lane gates it, like a
    // recurring card suppresses its due chip).
    tasksFixture = [
      makeTask({ id: 'zzz', text: 'Renew passport', due: '2000-01-01', start_date: future }),
    ]
    render(<GridHarness />)

    const card = screen.getByTestId('grid-card')
    expect(within(card).queryByText(/Overdue/)).toBeNull()
    expect(within(card).queryByText(/Stale/)).toBeNull()
    expect(card.style.animation).toBe('') // no urgency pulse
    // The ⏸ chip is the only status chip on the card.
    expect(within(card).getByText(/^⏸ starts /)).toBeInTheDocument()
  })

  it('keeps a dormant card OUT of clustering — it never folds into an active bubble', () => {
    // A paused card sharing an active card's coords must NOT merge into a cluster bubble: both
    // render as standalone cards (the active one draggable, the paused one read-only).
    tasksFixture = [
      makeTask({ id: 'active', text: 'Live task', x: 0.5, y: 0.5 }),
      makeTask({ id: 'zzz', text: 'Paused task', x: 0.5, y: 0.5, start_date: future }),
    ]
    render(<GridHarness />)

    expect(screen.queryByTestId('cluster-bubble')).toBeNull()
    const cards = screen.getAllByTestId('grid-card')
    expect(cards).toHaveLength(2)
    // The paused one is the read-only card; the active one is draggable.
    const pausedCard = cards.find((c) => c.hasAttribute('data-paused'))!
    const activeCard = cards.find((c) => !c.hasAttribute('data-paused'))!
    expect(within(pausedCard).getByText('Paused task')).toBeInTheDocument()
    expect(within(activeCard).getByText('Live task')).toBeInTheDocument()
    expect(activeCard.className).toContain('cursor-grab')
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

describe('GridView on-card ⋯ menu (the SchedulePanel)', () => {
  it('opens the menu with the schedule panel: calendar, time chips, repeats', () => {
    tasksFixture = [makeTask({ id: 'm', staged: false })]
    render(<GridHarness />)
    // Closed by default.
    expect(screen.queryByTestId('schedule-calendar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    expect(screen.getByText('Set a due date')).toBeInTheDocument()
    expect(screen.getByTestId('schedule-calendar')).toBeInTheDocument()
    // The type switch is always shown; the Repeats cadence appears only once Recurring is chosen.
    expect(screen.getByRole('group', { name: 'Task type' })).toBeInTheDocument()
  })

  it('setting a due date writes `due` ONLY — it never repositions the card', () => {
    tasksFixture = [makeTask({ id: 'm', x: 0.3, y: 0.7, staged: false })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    // Date-agnostic path: the “More dates…” escape hatch reveals the native input.
    fireEvent.click(screen.getByRole('button', { name: '📅 More dates…' }))
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-01' } })

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'm',
      patch: { due: '2026-08-01', due_time: null },
    })
    // Parity: no patch may carry x/y (that would move a manually-placed card).
    const patches = updateMutate.mock.calls.map((c) => (c[0] as { patch: object }).patch)
    expect(patches.some((p) => 'x' in p || 'y' in p)).toBe(false)
  })

  it('time presets: disabled until a date exists, write both columns; No date clears both', async () => {
    tasksFixture = [makeTask({ id: 'm', x: 0.3, y: 0.7, staged: false })]
    const noDate = render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    expect(screen.getByRole('button', { name: '6 PM' })).toBeDisabled()
    noDate.unmount()

    tasksFixture = [makeTask({ id: 'm', x: 0.3, y: 0.7, staged: false, due: '2026-08-01' })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    const evening = screen.getByRole('button', { name: '6 PM' })
    expect(evening).toBeEnabled()
    fireEvent.click(evening)
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'm',
      patch: { due: '2026-08-01', due_time: '18:00' },
    })
    // First due time on a reminder-less task → the user's default reminder (1 hour) is seeded
    // after the write lands, same as the add forms and BabyClaw.
    await waitFor(() => expect(reminderAdd).toHaveBeenCalledWith('m', 60))

    // Clearing the date clears the time with it (the DB CHECK forbids a dangling time).
    fireEvent.click(screen.getByRole('button', { name: 'No date' }))
    expect(updateMutate).toHaveBeenCalledWith({ id: 'm', patch: { due: null, due_time: null } })
  })

  it('switching the type to Recurring writes a fresh weekly recurring object (clears ongoing)', () => {
    tasksFixture = [makeTask({ id: 'm', staged: false })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    fireEvent.click(screen.getByRole('button', { name: 'Recurring' }))

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'm',
      patch: { recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 }, ongoing: false },
    })
  })

  it('switching the type to Ongoing sets the flag and clears any recurring', () => {
    tasksFixture = [makeTask({ id: 'm', staged: false })]
    render(<GridHarness />)
    fireEvent.click(screen.getByLabelText('Due date and recurring'))
    fireEvent.click(screen.getByRole('button', { name: 'Ongoing' }))

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'm',
      patch: { ongoing: true, recurring: null },
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

// Pressing inert background closes the open desktop chat rail (useBackgroundDismiss). That hook
// matches the pressed element EXACTLY, so what matters here is WHICH element carries the marker:
// the canvas must, and the cards sitting on it must not — otherwise starting a drag would close
// the drawer out from under you.
describe('GridView background-dismiss marker', () => {
  it('marks the canvas as background, and never a card on it', () => {
    tasksFixture = [makeTask({ id: 'a', text: 'Clean kitchen', x: 0.5, y: 0.5 })]
    render(<GridHarness />)

    expect(screen.getByTestId('grid-canvas')).toHaveAttribute(BACKGROUND_DISMISS_ATTR)
    expect(screen.getByTestId('grid-card')).not.toHaveAttribute(BACKGROUND_DISMISS_ATTR)
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

    // Plus the same quiet ⋯ (schedule menu) + × (delete) pair on the right.
    expect(within(rowA).getByRole('button', { name: 'Due date and recurring' })).toHaveTextContent(
      '⋯',
    )
    expect(within(rowA).getByRole('button', { name: 'Delete task' })).toHaveTextContent('×')
  })

  it('the ⋯ opens the schedule panel and its writes route to the folded task', () => {
    const { rowA } = openPopup()
    fireEvent.click(within(rowA).getByLabelText('Due date and recurring'))
    expect(screen.getByTestId('schedule-calendar')).toBeInTheDocument()

    // Switching the folded task's type to Recurring writes a fresh recurring object for THAT task —
    // no drag-out needed to schedule a clustered task, and no patch may carry x/y.
    fireEvent.click(screen.getByRole('button', { name: 'Recurring' }))
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'a',
      patch: { recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 }, ongoing: false },
    })
    const patches = updateMutate.mock.calls.map((c) => (c[0] as { patch: object }).patch)
    expect(patches.some((p) => 'x' in p || 'y' in p)).toBe(false)
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

describe('GridView iPad hybrid (coarse pointer, desktop layout)', () => {
  const cardFor = (text: string) =>
    screen.getByText(text).closest('[data-testid="grid-card"]') as HTMLElement

  it('a tap on a card opens the touch actions popover instead of dragging', () => {
    mockIsCoarse.mockReturnValue(true)
    tasksFixture = [makeTask({ id: 'p1', text: 'Tap me' })]
    render(<GridHarness />)
    const card = cardFor('Tap me')
    // A real tap: pointerdown, pointerup, then the browser's trailing click (detail 1).
    fireEvent.pointerDown(card, { clientX: 200, clientY: 200 })
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
    fireEvent.click(card, { detail: 1 })
    const popover = screen.getByTestId('touch-card-popover')
    expect(within(popover).getByRole('button', { name: /✓ Done/ })).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: /⋯ Schedule/ })).toBeInTheDocument()
    expect(within(popover).getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
    expect(updateMutate).not.toHaveBeenCalled() // the tap never repositioned the card
  })

  it('Done in the popover marks the task done and closes it', () => {
    mockIsCoarse.mockReturnValue(true)
    tasksFixture = [makeTask({ id: 'p2', text: 'Finish me' })]
    render(<GridHarness />)
    const card = cardFor('Finish me')
    fireEvent.pointerDown(card, { clientX: 200, clientY: 200 })
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
    fireEvent.click(
      within(screen.getByTestId('touch-card-popover')).getByRole('button', { name: /✓ Done/ }),
    )
    expect(markDoneMutate).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('touch-card-popover')).toBeNull()
  })

  it('a schedule write from the popover routes through setDue and never carries x/y', () => {
    mockIsCoarse.mockReturnValue(true)
    tasksFixture = [makeTask({ id: 'p3', text: 'Schedule me' })]
    render(<GridHarness />)
    const card = cardFor('Schedule me')
    fireEvent.pointerDown(card, { clientX: 200, clientY: 200 })
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
    const popover = screen.getByTestId('touch-card-popover')
    fireEvent.click(within(popover).getByRole('button', { name: /⋯ Schedule/ }))
    const calendar = within(popover).getByTestId('schedule-calendar')
    const tomorrow = new Date(Date.now() + 86_400_000)
    const dayButton = within(calendar)
      .getAllByRole('button')
      .find((b) => b.textContent?.trim() === String(tomorrow.getDate()))
    expect(dayButton).toBeDefined()
    fireEvent.click(dayButton!)
    expect(updateMutate).toHaveBeenCalled()
    for (const call of updateMutate.mock.calls) {
      const patch = (call[0] as { patch: Record<string, unknown> }).patch
      expect('x' in patch).toBe(false)
      expect('y' in patch).toBe(false)
    }
  })

  it('hold + move + release repositions with the finger offset; no popover opens', () => {
    vi.useFakeTimers()
    try {
      mockIsCoarse.mockReturnValue(true)
      tasksFixture = [makeTask({ id: 'p4', text: 'Hold me', x: 0.2, y: 0.2 })]
      render(<GridHarness />)
      const canvas = screen.getByTestId('grid-canvas')
      canvas.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 400,
          height: 800,
          right: 400,
          bottom: 800,
          x: 0,
          y: 0,
        }) as DOMRect
      const card = cardFor('Hold me')
      fireEvent.pointerDown(card, { clientX: 100, clientY: 600 })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      // The card rides 56px above the finger — finger at y = 200 + 56 drops the CARD at y 200.
      fireEvent.pointerMove(window, { clientX: 300, clientY: 256 })
      fireEvent.pointerUp(window, { clientX: 300, clientY: 256 })
      const repositionCall = updateMutate.mock.calls.find((c) => {
        const patch = (c[0] as { patch: Record<string, unknown> }).patch
        return 'x' in patch
      })
      expect(repositionCall).toBeDefined()
      const patch = (repositionCall![0] as { patch: { x: number; y: number } }).patch
      expect(patch.x).toBeCloseTo(0.75, 2)
      expect(patch.y).toBeCloseTo(0.75, 2)
      expect(screen.queryByTestId('touch-card-popover')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fine pointers never see the popover — a plain click on a card does nothing new', () => {
    tasksFixture = [makeTask({ id: 'p5', text: 'Desktop card' })]
    render(<GridHarness />)
    const card = cardFor('Desktop card')
    fireEvent.pointerDown(card, { clientX: 200, clientY: 200 })
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
    fireEvent.click(card, { detail: 1 })
    expect(screen.queryByTestId('touch-card-popover')).toBeNull()
  })

  it('starting a hold-drag on the tapped card closes its popover (no detached float)', () => {
    vi.useFakeTimers()
    try {
      mockIsCoarse.mockReturnValue(true)
      tasksFixture = [makeTask({ id: 'p7', text: 'Move after tap' })]
      render(<GridHarness />)
      const card = cardFor('Move after tap')
      // Open the popover.
      fireEvent.pointerDown(card, { clientX: 200, clientY: 200 })
      fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
      fireEvent.click(card, { detail: 1 })
      expect(screen.getByTestId('touch-card-popover')).toBeInTheDocument()
      // Now press-and-hold the same card to reposition — the lift must close the popover.
      fireEvent.pointerDown(card, { clientX: 200, clientY: 200 })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(screen.queryByTestId('touch-card-popover')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('tapping a second card moves the popover to it (capture-phase dismiss beats stopPropagation)', () => {
    mockIsCoarse.mockReturnValue(true)
    tasksFixture = [
      makeTask({ id: 'a1', text: 'First card', x: 0.2, y: 0.2 }),
      makeTask({ id: 'b1', text: 'Second card', x: 0.8, y: 0.8 }),
    ]
    render(<GridHarness />)
    const tap = (text: string) => {
      const card = cardFor(text)
      fireEvent.pointerDown(card, { clientX: 200, clientY: 200 })
      fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
      fireEvent.click(card, { detail: 1 })
    }
    tap('First card')
    expect(screen.getByRole('dialog', { name: 'Task: First card' })).toBeInTheDocument()
    tap('Second card')
    expect(screen.queryByRole('dialog', { name: 'Task: First card' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Task: Second card' })).toBeInTheDocument()
  })

  it('the action bar carries the coarse-halo marker (index.css grows 44pt tap targets off it)', () => {
    tasksFixture = [makeTask({ id: 'p6', text: 'Halo card' })]
    render(<GridHarness />)
    expect(cardFor('Halo card').querySelector('[data-card-actions]')).not.toBeNull()
  })
})
