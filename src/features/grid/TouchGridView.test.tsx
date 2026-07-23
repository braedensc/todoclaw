import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { useGrid } from './use-grid'
import { TouchGridSurface } from './TouchGridSurface'
import { ConfirmProvider } from '../../components/use-confirm'

// Behavioural tests for the fullscreen TOUCH grid (grid-only mode on phones / coarse-pointer
// devices). Harness mirrors GridView.test.tsx: useGrid + the surface wired together exactly as
// WorkArea does, inside the ConfirmProvider the delete flow needs.
const onExit = vi.fn()
const onOpenChat = vi.fn()

function TouchHarness({ chatUnread = 0 }: { chatUnread?: number }) {
  const gridRef = useRef<HTMLDivElement>(null)
  const grid = useGrid(gridRef)
  return (
    <ConfirmProvider>
      <TouchGridSurface
        grid={grid}
        gridRef={gridRef}
        onExit={onExit}
        onOpenChat={onOpenChat}
        chatUnread={chatUnread}
      />
    </ConfirmProvider>
  )
}

// Mock the data layer so the surface renders under jsdom with no Supabase/network (same shape as
// GridView.test.tsx — same folder, same module paths; useAddTask added for the ＋ MobileAddSheet).
const updateMutate = vi.fn()
const softDeleteMutate = vi.fn()
const markDoneMutate = vi.fn()
const addMutate = vi.fn()
let tasksFixture: Task[] = []
let doneTodayFixture: Record<string, boolean> = {}

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksFixture }),
  useUpdateTask: () => ({
    mutate: updateMutate,
    mutateAsync: async (vars: unknown) => updateMutate(vars),
  }),
  useSoftDeleteTask: () => ({ mutate: softDeleteMutate }),
  useAddTask: () => ({ mutate: addMutate }),
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
vi.mock('../reminders/use-task-reminders', () => ({
  useTaskReminders: () => ({ data: new Map() }),
  useTaskReminderWrites: () => ({
    add: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    toggle: vi.fn(),
  }),
}))

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
    created_at: new Date(Date.now() - 86_400_000).toISOString(), // ~1 day ago (now-relative)
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
  addMutate.mockClear()
  onExit.mockClear()
  onOpenChat.mockClear()
  tasksFixture = []
  doneTodayFixture = {}
})

afterEach(() => {
  vi.clearAllMocks()
})

const chipFor = (text: string) =>
  screen.getByText(text).closest('[data-testid="touch-chip"]') as HTMLElement

describe('TouchGridSurface rendering', () => {
  it('renders a chip per placed task at its x/(1-y) position, and hides staged tasks', () => {
    tasksFixture = [
      makeTask({ id: 'p', text: 'Placed', x: 0.25, y: 0.75 }),
      makeTask({ id: 's', text: 'Staged', staged: true, x: null, y: null }),
    ]
    render(<TouchHarness />)
    const chip = chipFor('Placed')
    expect(chip.style.left).toBe('25%')
    expect(chip.style.top).toBe('25%')
    expect(chip.dataset.quadrant).toBe('schedule')
    expect(screen.queryByText('Staged')).toBeNull()
  })

  it('renders a dormant (paused) task as a read-only data-paused chip, never clustered', () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    tasksFixture = [
      makeTask({ id: 'a', text: 'Active here', x: 0.5, y: 0.5 }),
      makeTask({ id: 'z', text: 'Paused here', x: 0.51, y: 0.51, start_date: future }),
    ]
    render(<TouchHarness />)
    // Co-located active + paused: two chips, no cluster bubble (dormant is excluded upstream).
    expect(screen.getAllByTestId('touch-chip')).toHaveLength(2)
    expect(screen.queryByTestId('cluster-bubble')).toBeNull()
    expect(chipFor('Paused here').dataset.paused).toBe('true')
    expect(within(chipFor('Paused here')).getByText(/⏸ starts/)).toBeInTheDocument()
  })

  it('folds overlapping tasks into one cluster bubble with the member count', () => {
    tasksFixture = [
      makeTask({ id: 'c1', text: 'First', x: 0.5, y: 0.5 }),
      makeTask({ id: 'c2', text: 'Second', x: 0.52, y: 0.51 }),
    ]
    render(<TouchHarness />)
    const bubble = screen.getByTestId('cluster-bubble')
    expect(within(bubble).getByText('2')).toBeInTheDocument()
    expect(screen.queryByTestId('touch-chip')).toBeNull()
  })

  it('shows the empty state when nothing is placed', () => {
    render(<TouchHarness />)
    expect(screen.getByText(/No tasks placed yet/)).toBeInTheDocument()
  })

  it('hides a chip the moment its task is in today’s done map (the fifth-surface invariant)', () => {
    tasksFixture = [makeTask({ id: 'dt', text: 'Done earlier today' })]
    doneTodayFixture = { dt: true }
    render(<TouchHarness />)
    expect(screen.queryByText('Done earlier today')).toBeNull()
  })

  it('a stale chip wears the full cool dress: ❄️ corner flag + azure frost chip, no warm chip', () => {
    // Deep-stale by construction: undated, on the board since 2000 (past the 90d floor).
    tasksFixture = [
      makeTask({ id: 'st1', text: 'Forgotten idea', created_at: '2000-01-01T00:00:00Z' }),
    ]
    render(<TouchHarness />)
    const chip = chipFor('Forgotten idea')
    expect(within(chip).getByText(/❄️ Stale/)).toBeInTheDocument()
    expect(
      within(chip)
        .getAllByTitle(/Stale —/)
        .some((el) => el.textContent === '❄️'),
    ).toBe(true)
  })

  it('an overdue chip wears the 🔥 corner flag + glow ring + pulse, like the desktop card', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
    tasksFixture = [makeTask({ id: 'od', text: 'Renew insurance', due: twoDaysAgo })]
    render(<TouchHarness />)
    const chip = chipFor('Renew insurance')
    expect(within(chip).getByTitle('Overdue').textContent).toBe('🔥')
    expect(chip.style.boxShadow).toContain('rgba(194,105,63')
    expect(chip.style.animation).toContain('urgency-pulse')
  })

  it('a paused chip wears the 💤 corner flag alongside its ⏸ chip', () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    tasksFixture = [makeTask({ id: 'pz', text: 'Napping task', start_date: future })]
    render(<TouchHarness />)
    expect(
      within(chipFor('Napping task'))
        .getAllByTitle(/Paused/)
        .some((el) => el.textContent === '💤'),
    ).toBe(true)
  })

  it('a well-practiced recurring chip shows its ×N completion count (≥3, like the card)', () => {
    tasksFixture = [
      makeTask({
        id: 'rn',
        text: 'Water plants',
        recurring: {
          frequencyDays: 7,
          lastDoneAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          doneCount: 5,
        },
      }),
    ]
    render(<TouchHarness />)
    expect(within(chipFor('Water plants')).getByText(/5×/)).toBeInTheDocument()
  })

  it('an ongoing chip carries the ∞ marker inline (the corner stays free for 🔥/❄️)', () => {
    tasksFixture = [makeTask({ id: 'og', text: 'Learn piano', ongoing: true })]
    render(<TouchHarness />)
    expect(within(chipFor('Learn piano')).getByTitle('Ongoing project').textContent).toBe('∞')
  })

  it('a stale cluster member shows the same ❄️ chip in the member list (lane-gating parity)', () => {
    tasksFixture = [
      makeTask({
        id: 'st1',
        text: 'Forgotten idea',
        x: 0.3,
        y: 0.3,
        created_at: '2000-01-01T00:00:00Z',
      }),
      makeTask({ id: 'st2', text: 'Fresh neighbor', x: 0.31, y: 0.31 }),
    ]
    render(<TouchHarness />)
    fireEvent.click(within(screen.getByTestId('cluster-bubble')).getByRole('button'))
    const list = screen.getByRole('dialog', { name: '2 tasks here' })
    expect(within(list).getByText(/Stale/)).toBeInTheDocument()
  })

  it('wears the recurring grammar on chips (↻ chip + status text)', () => {
    tasksFixture = [
      makeTask({
        id: 'r',
        text: 'Water plants',
        // Done 2 days ago on a 7-day cadence: mid-cycle "in 5d" (soon) — visibly recurring, but
        // NOT done-today (that would correctly hide it from the board) and NOT status 'ok'
        // (isPlaced hides 'ok' recurring tasks between cycles).
        recurring: {
          frequencyDays: 7,
          lastDoneAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          doneCount: 4,
        },
      }),
    ]
    render(<TouchHarness />)
    expect(within(chipFor('Water plants')).getAllByText(/↻/).length).toBeGreaterThan(0)
  })
})

describe('TouchGridSurface task sheet', () => {
  it('tap chip → action sheet; Done marks a one-off done and closes', () => {
    tasksFixture = [makeTask({ id: 't1', text: 'Renew insurance' })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Renew insurance'))
    const sheet = screen.getByRole('dialog', { name: 'Task: Renew insurance' })
    fireEvent.click(within(sheet).getByRole('button', { name: /✓ Done/ }))
    expect(markDoneMutate).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Done on a recurring task resets its clock instead of writing history', () => {
    tasksFixture = [
      makeTask({
        id: 'r1',
        text: 'Gym',
        recurring: { frequencyDays: 3, lastDoneAt: null, doneCount: 0 },
      }),
    ]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Gym'))
    fireEvent.click(screen.getByRole('button', { name: /✓ Done/ }))
    expect(markDoneMutate).not.toHaveBeenCalled()
    expect(updateMutate).toHaveBeenCalledTimes(1)
    const arg = updateMutate.mock.calls[0]?.[0] as {
      id: string
      patch: { recurring: { lastDoneAt: string | null; doneCount: number } }
    }
    expect(arg.id).toBe('r1')
    expect(arg.patch.recurring.doneCount).toBe(1)
    expect(arg.patch.recurring.lastDoneAt).not.toBeNull()
  })

  it('delete is confirm-gated: soft-delete fires only after confirming', async () => {
    tasksFixture = [makeTask({ id: 'd1', text: 'Old chore' })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Old chore'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(softDeleteMutate).not.toHaveBeenCalled()
    const confirmDialog = await screen.findByRole('dialog', { name: /Delete “Old chore”\?/ })
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(softDeleteMutate).toHaveBeenCalledWith('d1'))
  })

  it('tap the title → inline rename commits through updateMutate', () => {
    tasksFixture = [makeTask({ id: 'n1', text: 'Old name' })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Old name'))
    const sheet = screen.getByRole('dialog', { name: 'Task: Old name' })
    fireEvent.click(within(sheet).getByRole('button', { name: /Old name/ }))
    const input = within(sheet).getByRole('textbox', { name: 'Task name' })
    fireEvent.change(input, { target: { value: 'New name' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateMutate).toHaveBeenCalledWith({ id: 'n1', patch: { text: 'New name' } })
  })

  it('a paused task sheet offers Schedule + Delete but no Done/Move', () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    tasksFixture = [makeTask({ id: 'z1', text: 'Paused task', start_date: future })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Paused task'))
    const sheet = screen.getByRole('dialog', { name: 'Task: Paused task' })
    expect(within(sheet).queryByRole('button', { name: /✓ Done/ })).toBeNull()
    expect(within(sheet).queryByRole('button', { name: /⇢ Move/ })).toBeNull()
    expect(within(sheet).getByRole('button', { name: /⋯ Schedule/ })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
  })

  it('a due write from the schedule panel never repositions the chip (no x/y in the patch)', () => {
    tasksFixture = [makeTask({ id: 's1', text: 'Schedule me', x: 0.3, y: 0.6 })]
    const { rerender } = render(<TouchHarness />)
    fireEvent.click(chipFor('Schedule me'))
    fireEvent.click(screen.getByRole('button', { name: /⋯ Schedule/ }))
    // Pick tomorrow on the SchedulePanel calendar (its cells are buttons named by day number).
    const tomorrow = new Date(Date.now() + 86_400_000)
    const panel = screen.getByRole('dialog', { name: 'Task: Schedule me' })
    const calendar = within(panel).getByTestId('schedule-calendar')
    // Host-local "tomorrow" is always inside the panel's 14-day window regardless of the mocked
    // timezone's offset; day numbers never repeat within two weeks.
    const dayButtons = within(calendar)
      .getAllByRole('button')
      .filter((b) => b.textContent?.trim() === String(tomorrow.getDate()))
    expect(dayButtons.length).toBeGreaterThan(0)
    fireEvent.click(dayButtons[0]!)
    // The write must route through useSetDueWithDefaultReminder: the patch carries the picked
    // date (and later the time), and NEVER x/y — a due write must not reposition (#305 / the
    // grid invariant).
    expect(updateMutate).toHaveBeenCalled()
    const datePatch = (updateMutate.mock.calls.at(-1)?.[0] as { patch: Record<string, unknown> })
      .patch
    expect(typeof datePatch.due).toBe('string')
    // Reflect the write back into the fixture (the real query cache would) so the time preset
    // sees the task WITH a date — a time is only valid alongside one (DB CHECK).
    tasksFixture = [{ ...tasksFixture[0]!, due: datePatch.due as string }]
    rerender(<TouchHarness />)
    fireEvent.click(within(panel).getByRole('button', { name: '9 AM' }))
    const timePatch = (updateMutate.mock.calls.at(-1)?.[0] as { patch: Record<string, unknown> })
      .patch
    expect(timePatch.due_time).toBe('09:00')
    for (const call of updateMutate.mock.calls) {
      const patch = (call[0] as { patch: Record<string, unknown> }).patch
      expect('x' in patch).toBe(false)
      expect('y' in patch).toBe(false)
    }
  })
})

describe('TouchGridSurface move mode (tap-to-place)', () => {
  it('Move arms the banner; a canvas tap commits the new position and disarms', () => {
    tasksFixture = [makeTask({ id: 'm1', text: 'Move me', x: 0.2, y: 0.2 })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Move me'))
    fireEvent.click(screen.getByRole('button', { name: /⇢ Move/ }))
    expect(screen.getByText(/Tap where “Move me” should go/)).toBeInTheDocument()

    const canvas = screen.getByTestId('touch-grid-canvas')
    // jsdom lays out at 0×0 — stub the rect so toNormalized has a real coordinate space.
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0 }) as DOMRect
    fireEvent.pointerDown(canvas, { clientX: 300, clientY: 200 })

    expect(updateMutate).toHaveBeenCalledTimes(1)
    const arg = updateMutate.mock.calls[0]?.[0] as {
      id: string
      patch: { x: number; y: number; staged: boolean }
    }
    expect(arg.id).toBe('m1')
    expect(arg.patch.staged).toBe(false)
    expect(arg.patch.x).toBeCloseTo(0.75, 2)
    expect(arg.patch.y).toBeCloseTo(0.75, 2) // screen y 200/800 → data y inverted
    expect(screen.queryByText(/Tap where/)).toBeNull()
  })

  it('Cancel disarms without writing — including its pointerdown (real taps fire it first)', () => {
    tasksFixture = [makeTask({ id: 'm2', text: 'Stay put' })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Stay put'))
    fireEvent.click(screen.getByRole('button', { name: /⇢ Move/ }))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    // A real tap = pointerdown THEN click. The pointerdown bubbles to the canvas handler; the
    // target guard must ignore it or Cancel would commit the move at the banner's coordinates.
    fireEvent.pointerDown(cancel, { clientX: 200, clientY: 20 })
    fireEvent.click(cancel)
    expect(screen.queryByText(/Tap where/)).toBeNull()
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('a tap on the floating chrome while armed never commits the move', () => {
    tasksFixture = [makeTask({ id: 'm3', text: 'Precious position' })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Precious position'))
    fireEvent.click(screen.getByRole('button', { name: /⇢ Move/ }))
    for (const name of [/Exit grid view/, /Add a task/, /Open chat/]) {
      fireEvent.pointerDown(screen.getByRole('button', { name }), { clientX: 350, clientY: 700 })
    }
    expect(updateMutate).not.toHaveBeenCalled()
    expect(screen.getByText(/Tap where/)).toBeInTheDocument()
  })

  it('chips are pointer-inert while a move is armed (the whole screen is the drop target)', () => {
    tasksFixture = [
      makeTask({ id: 'm4', text: 'Mover', x: 0.2, y: 0.2 }),
      makeTask({ id: 'm5', text: 'Bystander', x: 0.8, y: 0.8 }),
    ]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Mover'))
    fireEvent.click(screen.getByRole('button', { name: /⇢ Move/ }))
    // jsdom doesn't enforce pointer-events, so pin the class that does it in a browser.
    expect(screen.getByTestId('chip-layer').className).toContain('pointer-events-none')
  })
})

describe('TouchGridSurface hold-drag', () => {
  const stubRect = () => {
    const canvas = screen.getByTestId('touch-grid-canvas')
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0 }) as DOMRect
    return canvas
  }

  it('press-and-hold lifts the chip; move + release commits the offset-corrected position', () => {
    vi.useFakeTimers()
    try {
      tasksFixture = [makeTask({ id: 'h1', text: 'Hold me', x: 0.2, y: 0.2 })]
      render(<TouchHarness />)
      stubRect()
      fireEvent.pointerDown(chipFor('Hold me'), { clientX: 100, clientY: 600 })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      // The chip rides 56px above the finger — drop the finger at y = 200 + 56 so the CHIP
      // (and therefore the committed point) lands at screen y 200 → data y 0.75.
      fireEvent.pointerMove(window, { clientX: 300, clientY: 256 })
      fireEvent.pointerUp(window)
      expect(updateMutate).toHaveBeenCalledTimes(1)
      const arg = updateMutate.mock.calls[0]?.[0] as {
        id: string
        patch: { x: number; y: number; staged: boolean }
      }
      expect(arg.id).toBe('h1')
      expect(arg.patch.x).toBeCloseTo(0.75, 2)
      expect(arg.patch.y).toBeCloseTo(0.75, 2)
      expect(arg.patch.staged).toBe(false)
      expect(screen.queryByRole('dialog')).toBeNull() // a drag is never also a tap
    } finally {
      vi.useRealTimers()
    }
  })

  it('a quick press-and-release still opens the sheet (the hook delivers the tap)', () => {
    tasksFixture = [makeTask({ id: 'h2', text: 'Just a tap' })]
    render(<TouchHarness />)
    stubRect()
    fireEvent.pointerDown(chipFor('Just a tap'), { clientX: 200, clientY: 400 })
    fireEvent.pointerUp(window)
    expect(screen.getByRole('dialog', { name: 'Task: Just a tap' })).toBeInTheDocument()
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('keyboard activation (click with detail 0) opens the sheet on a draggable chip', () => {
    tasksFixture = [makeTask({ id: 'h3', text: 'Keyed open' })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Keyed open')) // fireEvent.click has detail 0 — the keyboard path
    expect(screen.getByRole('dialog', { name: 'Task: Keyed open' })).toBeInTheDocument()
  })

  it('paused chips are not draggable: no hold wiring, plain click opens the sheet', () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    tasksFixture = [makeTask({ id: 'h4', text: 'Asleep', start_date: future })]
    render(<TouchHarness />)
    const chip = chipFor('Asleep')
    expect(chip.style.touchAction).toBe('')
    fireEvent.click(chip)
    expect(screen.getByRole('dialog', { name: 'Task: Asleep' })).toBeInTheDocument()
  })

  it('a lift that never moves settles back without writing', () => {
    vi.useFakeTimers()
    try {
      tasksFixture = [makeTask({ id: 'h5', text: 'Long press only', x: 0.4, y: 0.4 })]
      render(<TouchHarness />)
      stubRect()
      fireEvent.pointerDown(chipFor('Long press only'), { clientX: 160, clientY: 480 })
      act(() => {
        vi.advanceTimersByTime(300)
      })
      fireEvent.pointerUp(window)
      expect(updateMutate).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TouchGridSurface clusters', () => {
  it('tap bubble → member list; picking a member opens its action sheet', () => {
    tasksFixture = [
      makeTask({ id: 'c1', text: 'First of two', x: 0.5, y: 0.5 }),
      makeTask({ id: 'c2', text: 'Second of two', x: 0.52, y: 0.51 }),
    ]
    render(<TouchHarness />)
    fireEvent.click(within(screen.getByTestId('cluster-bubble')).getByRole('button'))
    const list = screen.getByRole('dialog', { name: '2 tasks here' })
    fireEvent.click(within(list).getByText('Second of two'))
    expect(screen.getByRole('dialog', { name: 'Task: Second of two' })).toBeInTheDocument()
  })
})

describe('TouchGridSurface live-data auto-close', () => {
  it('the task sheet closes when its task vanishes from the data (done/deleted elsewhere)', () => {
    tasksFixture = [makeTask({ id: 'v1', text: 'Ephemeral' })]
    const { rerender } = render(<TouchHarness />)
    fireEvent.click(chipFor('Ephemeral'))
    expect(screen.getByRole('dialog', { name: 'Task: Ephemeral' })).toBeInTheDocument()
    tasksFixture = []
    rerender(<TouchHarness />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the cluster sheet closes when the group dissolves to a single member', () => {
    tasksFixture = [
      makeTask({ id: 'g1', text: 'Stays', x: 0.5, y: 0.5 }),
      makeTask({ id: 'g2', text: 'Leaves', x: 0.52, y: 0.51 }),
    ]
    const { rerender } = render(<TouchHarness />)
    fireEvent.click(within(screen.getByTestId('cluster-bubble')).getByRole('button'))
    expect(screen.getByRole('dialog', { name: '2 tasks here' })).toBeInTheDocument()
    tasksFixture = [tasksFixture[0]!]
    rerender(<TouchHarness />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the move banner cancels itself when the moving task vanishes', () => {
    tasksFixture = [makeTask({ id: 'mv', text: 'Gone soon' })]
    const { rerender } = render(<TouchHarness />)
    fireEvent.click(chipFor('Gone soon'))
    fireEvent.click(screen.getByRole('button', { name: /⇢ Move/ }))
    expect(screen.getByText(/Tap where/)).toBeInTheDocument()
    tasksFixture = []
    rerender(<TouchHarness />)
    expect(screen.queryByText(/Tap where/)).toBeNull()
  })
})

describe('TouchGridSurface chrome', () => {
  it('✕ exits, 🐾 opens chat, ＋ opens the add sheet', () => {
    tasksFixture = [makeTask({ id: 'x', text: 'Anything' })]
    render(<TouchHarness chatUnread={2} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit grid view' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /Open chat/ }))
    expect(onOpenChat).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }))
    expect(screen.getByRole('dialog', { name: 'Add a task' })).toBeInTheDocument()
  })

  it('the chat button announces + shows unread, and drops both at zero', () => {
    const { rerender } = render(<TouchHarness chatUnread={2} />)
    expect(screen.getByRole('button', { name: 'Open chat — 2 unread' })).toBeInTheDocument()
    expect(screen.getByTestId('chat-unread-dot')).toBeInTheDocument()
    rerender(<TouchHarness chatUnread={0} />)
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument()
    expect(screen.queryByTestId('chat-unread-dot')).toBeNull()
  })
})
