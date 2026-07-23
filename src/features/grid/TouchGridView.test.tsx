import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    render(<TouchHarness />)
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
    expect(updateMutate).toHaveBeenCalled()
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

  it('Cancel disarms without writing', () => {
    tasksFixture = [makeTask({ id: 'm2', text: 'Stay put' })]
    render(<TouchHarness />)
    fireEvent.click(chipFor('Stay put'))
    fireEvent.click(screen.getByRole('button', { name: /⇢ Move/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/Tap where/)).toBeNull()
    expect(updateMutate).not.toHaveBeenCalled()
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

describe('TouchGridSurface chrome', () => {
  it('✕ exits, 🐾 opens chat (with an unread dot), ＋ opens the add sheet', () => {
    tasksFixture = [makeTask({ id: 'x', text: 'Anything' })]
    render(<TouchHarness chatUnread={2} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exit grid view' }))
    expect(onExit).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }))
    expect(onOpenChat).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Add a task' }))
    expect(screen.getByRole('dialog', { name: 'Add a task' })).toBeInTheDocument()
  })
})
