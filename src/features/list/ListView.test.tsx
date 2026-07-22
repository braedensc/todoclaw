import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { Task } from '../../types/task'
import { ListView, type ListViewProps } from './ListView'
import { ConfirmProvider } from '../../components/use-confirm'
import { quadrantMeta } from '../../lib/quadrants'
import { resolveCollision } from '../../lib/collision'

// Component tests with all data hooks mocked (no Supabase, no network). We assert the
// behavior the list OWNS — ranking order, quadrant coloring, the whole-row expand toggle +
// double-click-to-edit, slider commit wiring, the unplaced badge, done-today exclusion, the
// done control's normal-vs-recurring branch, the confirm-gated delete, and the recurring
// set/remove controls. The pure logic itself (taskScore, resolveCollision math, recurring
// thresholds/colors) is covered in src/lib/*.test.ts.
//
// ListView calls useConfirm, so every render is wrapped in a real <ConfirmProvider> (renderList)
// — the same provider App mounts at the root — which also hosts the delete confirm dialog.

// Wrap ListView in the confirm provider it depends on (hosts the delete ConfirmDialog).
function renderList(props: ListViewProps = {}) {
  return render(
    <ConfirmProvider>
      <ListView {...props} />
    </ConfirmProvider>,
  )
}

const updateMutate = vi.fn()
const deleteMutate = vi.fn()
const markDoneMutate = vi.fn()
let tasksData: Task[] = []
let doneToday: Record<string, true> = {}

vi.mock('../tasks/use-tasks', () => ({
  useTasks: () => ({ data: tasksData, isLoading: false, isError: false }),
  // Due writes go through the shared setDue hook's mutateAsync; forwarding it to the same spy
  // keeps every write-path assertion on the one updateMutate ledger.
  useUpdateTask: () => ({
    mutate: updateMutate,
    mutateAsync: async (vars: unknown) => updateMutate(vars),
  }),
  useSoftDeleteTask: () => ({ mutate: deleteMutate }),
}))
vi.mock('../done/use-history', () => ({
  useMarkTaskDone: () => ({ mutate: markDoneMutate }),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'UTC', config: {} } }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => ({
    data: { done: doneToday, done_at: {}, habit_done: {}, subtask_done: {} },
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

// A complete Task row with sensible defaults; override per test.
function makeTask(over: Partial<Task>): Task {
  return {
    id: 'id',
    user_id: 'u1',
    text: 'task',
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    completed_at: null,
    start_date: null,
    ...over,
  }
}

beforeEach(() => {
  updateMutate.mockClear()
  deleteMutate.mockClear()
  markDoneMutate.mockClear()
  reminderAdd.mockClear()
  tasksData = []
  doneToday = {}
})

// A recent ISO timestamp (yesterday) so a recurring task with a real frequency reads as a
// live cycle rather than "never done". Used by the recurring-section tests.
const RECENT = new Date(Date.now() - 86_400_000).toISOString()

// A wall-clock day N days out (UTC slice — matches the mocked 'UTC' timezone). Small N keeps it
// inside the schedule panel's two-week calendar whatever day the suite runs.
const daysFromNowISO = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

describe('ListView', () => {
  it('renders rows in descending score order', () => {
    // low score (someday corner) vs high score (do-now corner)
    tasksData = [
      makeTask({ id: 'low', text: 'low priority', x: 0.1, y: 0.1 }),
      makeTask({ id: 'high', text: 'high priority', x: 0.9, y: 0.9 }),
    ]
    renderList()

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    // First row is the higher-scoring task, ranked #1.
    expect(within(items[0]!).getByText('high priority')).toBeInTheDocument()
    expect(within(items[0]!).getByLabelText('Rank 1')).toBeInTheDocument()
    expect(within(items[1]!).getByText('low priority')).toBeInTheDocument()
    expect(within(items[1]!).getByLabelText('Rank 2')).toBeInTheDocument()
  })

  it('colors the rank number and left border by quadrant', () => {
    tasksData = [makeTask({ id: 'a', text: 'do now task', x: 0.9, y: 0.9 })]
    renderList()

    const color = quadrantMeta(0.9, 0.9).color // Do Now → #bf5e2a
    const rank = screen.getByLabelText('Rank 1')
    expect(rank).toHaveStyle({ color })
    const item = screen.getByRole('listitem')
    expect(item).toHaveStyle({ borderLeft: `4px solid ${color}` })
  })

  it('double-clicking the row opens an inline edit that commits via useUpdateTask', () => {
    tasksData = [makeTask({ id: 'edit-me', text: 'old text' })]
    renderList()

    fireEvent.dblClick(screen.getByText('old text'))
    const input = screen.getByLabelText('Edit task text')
    fireEvent.change(input, { target: { value: 'new text' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateMutate).toHaveBeenCalledWith({ id: 'edit-me', patch: { text: 'new text' } })
  })

  it('expanded-row due editors write BOTH due columns; clearing the date clears the time', () => {
    // Computed ~6 weeks out so the due always sits OFF the SchedulePanel's two-week grid — that
    // (dueOffGrid) is what auto-reveals the raw "Due date" input this test drives. A hardcoded
    // date rotted INTO the grid as real time passed, hiding the input behind the More… toggle.
    const farDue = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10)
    tasksData = [makeTask({ id: 'x', text: 'timed task', due: farDue, due_time: '15:00:00' })]
    renderList()
    fireEvent.click(screen.getByText('timed task'))

    // Badge surfaces the time for near dates via dueLabel — here just assert the inputs hydrate
    // from the wire formats ('YYYY-MM-DD' / 'HH:MM:SS' → 'HH:MM').
    expect(screen.getByLabelText('Due date')).toHaveValue(farDue)
    expect(screen.getByLabelText('Due time')).toHaveValue('15:00')

    fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '09:30' } })
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'x',
      patch: { due: farDue, due_time: '09:30' },
    })

    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '' } })
    expect(updateMutate).toHaveBeenCalledWith({ id: 'x', patch: { due: null, due_time: null } })
  })

  it('a first due time on a reminder-less task seeds the default reminder', async () => {
    tasksData = [makeTask({ id: 'seed-me', text: 'dated, no time', due: daysFromNowISO(3) })]
    renderList()
    fireEvent.click(screen.getByText('dated, no time'))

    fireEvent.click(screen.getByRole('button', { name: 'Noon' }))

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'seed-me',
      patch: { due: daysFromNowISO(3), due_time: '12:00' },
    })
    // The user's default (1 hour, config untouched) arms AFTER the due write lands — the same
    // behavior as the add forms and BabyClaw's set_due_date.
    await waitFor(() => expect(reminderAdd).toHaveBeenCalledWith('seed-me', 60))
  })

  it('single-clicking the row body toggles the expanded detail panel', () => {
    tasksData = [makeTask({ id: 'x', text: 'expand me' })]
    renderList()

    // Collapsed: the expand button reports aria-expanded=false and no sliders render.
    const rowButton = screen.getByRole('button', { name: /expand me/ })
    expect(rowButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Urgency slider')).not.toBeInTheDocument()

    // Clicking the row body opens the panel… (click the button element itself — once expanded,
    // the SchedulePanel header also echoes the task text, so a text query would be ambiguous)
    fireEvent.click(rowButton)
    expect(rowButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Urgency slider')).toBeInTheDocument()

    // …and clicking again collapses it.
    fireEvent.click(rowButton)
    expect(screen.queryByLabelText('Urgency slider')).not.toBeInTheDocument()
  })

  it('runs collision resolution then commits resolved coords on slider commit', () => {
    // Two tasks: target's slider commit must avoid the blocker, so resolveCollision shifts it.
    const blocker = makeTask({ id: 'blocker', text: 'blocker', x: 0.9, y: 0.9 })
    const mover = makeTask({ id: 'mover', text: 'mover', x: 0.1, y: 0.1 })
    tasksData = [blocker, mover]
    renderList()

    // Expand the mover row (#2) by clicking its body, then drag its urgency slider to overlap.
    const moverRow = screen.getByText('mover').closest('li')!
    fireEvent.click(within(moverRow).getByText('mover'))
    const urgency = within(moverRow).getByLabelText('Urgency slider')
    fireEvent.change(urgency, { target: { value: '90' } })
    const importance = within(moverRow).getByLabelText('Importance slider')
    fireEvent.change(importance, { target: { value: '90' } })
    fireEvent.pointerUp(urgency)

    // Expected payload is exactly what resolveCollision returns for the same inputs.
    const expected = resolveCollision(0.9, 0.9, tasksData, 'mover')
    expect(updateMutate).toHaveBeenCalledWith({
      id: 'mover',
      patch: { x: expected.x, y: expected.y },
    })
    // The committed spot must NOT be the raw overlapping target — collision moved it.
    expect(expected).not.toEqual({ x: 0.9, y: 0.9 })
  })

  it('shows an "unplaced" badge for not-yet-placed (staged) tasks', () => {
    tasksData = [makeTask({ id: 's', text: 'staged task', staged: true })]
    renderList()
    expect(screen.getByText('unplaced')).toBeInTheDocument()
  })

  it('excludes tasks marked done today', () => {
    tasksData = [
      makeTask({ id: 'done', text: 'done today' }),
      makeTask({ id: 'open', text: 'still open' }),
    ]
    doneToday = { done: true }
    renderList()

    expect(screen.queryByText('done today')).not.toBeInTheDocument()
    expect(screen.getByText('still open')).toBeInTheDocument()
  })

  it('excludes completed tasks even when today’s daily state is empty (the next-day case)', () => {
    // Regression: a one-off completion used to live only in today's daily_state.done map, so a
    // fresh (empty) day resurrected it. completed_at makes the hide permanent — with doneToday
    // empty (a new day), a completed task must still stay out of the list.
    tasksData = [
      makeTask({ id: 'done', text: 'completed task', completed_at: '2026-06-23T12:00:00Z' }),
      makeTask({ id: 'open', text: 'still open' }),
    ]
    doneToday = {}
    renderList()

    expect(screen.queryByText('completed task')).not.toBeInTheDocument()
    expect(screen.getByText('still open')).toBeInTheDocument()
  })

  it('shows the empty state when there are no active tasks', () => {
    tasksData = []
    renderList()
    expect(screen.getByText(/No tasks yet/i)).toBeInTheDocument()
  })

  describe('done control', () => {
    it('marks a NORMAL task done via useMarkTaskDone (not useUpdateTask)', () => {
      tasksData = [makeTask({ id: 'n1', text: 'normal', bucket: 'oneoff' })]
      renderList()

      fireEvent.click(screen.getByLabelText('Mark done'))

      expect(markDoneMutate).toHaveBeenCalledWith({
        taskId: 'n1',
        text: 'normal',
        bucket: 'oneoff',
        timeZone: 'UTC',
      })
      // A normal mark-done must NOT touch the recurring/task update path.
      expect(updateMutate).not.toHaveBeenCalled()
    })

    it('marks a RECURRING task done via useUpdateTask with a bumped cycle (no history)', () => {
      tasksData = [
        makeTask({
          id: 'r1',
          text: 'chore',
          recurring: { frequencyDays: 7, lastDoneAt: RECENT, doneCount: 2 },
        }),
      ]
      renderList()

      fireEvent.click(screen.getByLabelText('Mark done (resets clock)'))

      // Recurring done resets the clock: doneCount bumps, lastDoneAt becomes a fresh ISO.
      expect(markDoneMutate).not.toHaveBeenCalled()
      expect(updateMutate).toHaveBeenCalledTimes(1)
      const arg = updateMutate.mock.calls[0]![0] as {
        id: string
        patch: { recurring: { frequencyDays: number; lastDoneAt: string; doneCount: number } }
      }
      expect(arg.id).toBe('r1')
      expect(arg.patch.recurring.frequencyDays).toBe(7)
      expect(arg.patch.recurring.doneCount).toBe(3)
      expect(arg.patch.recurring.lastDoneAt).not.toBe(RECENT)
      expect(Number.isNaN(Date.parse(arg.patch.recurring.lastDoneAt))).toBe(false)
    })
  })

  describe('delete', () => {
    it('soft-deletes only after the confirm dialog is accepted', async () => {
      tasksData = [makeTask({ id: 'del', text: 'delete me' })]
      renderList()

      fireEvent.click(screen.getByLabelText('Delete task'))
      // The app-themed confirm gate appears; nothing is deleted until it's accepted.
      const dialog = await screen.findByRole('dialog')
      expect(deleteMutate).not.toHaveBeenCalled()

      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('del'))
    })

    it('does not delete when the confirm dialog is cancelled', async () => {
      tasksData = [makeTask({ id: 'keep', text: 'keep me' })]
      renderList()

      fireEvent.click(screen.getByLabelText('Delete task'))
      const dialog = await screen.findByRole('dialog')
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      // Dialog dismisses and no soft-delete fires.
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(deleteMutate).not.toHaveBeenCalled()
    })
  })

  describe('recurring section (expanded row — SchedulePanel Repeats)', () => {
    it('switching a plain task to Recurring makes it a fresh weekly chore (clears ongoing)', () => {
      tasksData = [makeTask({ id: 's1', text: 'make me recurring', recurring: null })]
      renderList()

      fireEvent.click(screen.getByText('make me recurring'))
      fireEvent.click(screen.getByRole('button', { name: 'Recurring' }))

      expect(updateMutate).toHaveBeenCalledWith({
        id: 's1',
        patch: { recurring: { frequencyDays: 7, lastDoneAt: null, doneCount: 0 }, ongoing: false },
      })
    })

    it('switching a recurring task back to Task clears recurring', () => {
      tasksData = [
        makeTask({
          id: 'rm1',
          text: 'stop repeating',
          recurring: { frequencyDays: 30, lastDoneAt: RECENT, doneCount: 1 },
        }),
      ]
      renderList()

      fireEvent.click(screen.getByText('stop repeating'))
      fireEvent.click(screen.getByRole('button', { name: 'Task' }))

      expect(updateMutate).toHaveBeenCalledWith({ id: 'rm1', patch: { recurring: null } })
    })

    it('renders the cadence (fmtFrequency) and status label for a recurring task', () => {
      // 7-day cadence done yesterday → "weekly" + an in-Nd "soon"/"ok" status label.
      tasksData = [
        makeTask({
          id: 'f1',
          text: 'weekly chore',
          recurring: { frequencyDays: 7, lastDoneAt: RECENT, doneCount: 1 },
        }),
      ]
      renderList()

      fireEvent.click(screen.getByText('weekly chore'))
      // fmtFrequency(7) === 'weekly'; the recurring section renders the cadence word.
      expect(screen.getAllByText(/weekly/).length).toBeGreaterThan(0)
      // recurringStatus → "in 6d" (daysLeft 6). The label shows in both the collapsed row's
      // status span and the panel's garnish line, so assert at least one is present.
      expect(screen.getAllByText(/in 6d/).length).toBeGreaterThan(0)
      // The Repeats segmented control reflects the current cadence (7 → Weekly pressed).
      expect(screen.getByRole('button', { name: 'Weekly' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('shows the ×N count badge once doneCount >= 3', () => {
      tasksData = [
        makeTask({
          id: 'c1',
          text: 'counted',
          recurring: { frequencyDays: 2, lastDoneAt: RECENT, doneCount: 4 },
        }),
      ]
      renderList()
      expect(screen.getByLabelText('Completed 4 times')).toHaveTextContent('×4')
    })

    it('hides the ×N count badge below doneCount 3', () => {
      tasksData = [
        makeTask({
          id: 'c2',
          text: 'not counted',
          recurring: { frequencyDays: 2, lastDoneAt: RECENT, doneCount: 2 },
        }),
      ]
      renderList()
      expect(screen.queryByLabelText(/Completed/)).not.toBeInTheDocument()
    })
  })

  describe('ongoing projects (expanded row — SchedulePanel type switch)', () => {
    it('switching a task to Ongoing sets the flag and clears any recurring', () => {
      tasksData = [makeTask({ id: 'o1', text: 'redesign the site', recurring: null })]
      renderList()

      fireEvent.click(screen.getByText('redesign the site'))
      fireEvent.click(screen.getByRole('button', { name: 'Ongoing' }))

      expect(updateMutate).toHaveBeenCalledWith({
        id: 'o1',
        patch: { ongoing: true, recurring: null },
      })
    })

    it('switching a recurring task to Ongoing drops its schedule in one write', () => {
      tasksData = [
        makeTask({
          id: 'o2',
          text: 'ship the redesign',
          recurring: { frequencyDays: 7, lastDoneAt: RECENT, doneCount: 4 },
        }),
      ]
      renderList()

      fireEvent.click(screen.getByText('ship the redesign'))
      fireEvent.click(screen.getByRole('button', { name: 'Ongoing' }))

      expect(updateMutate).toHaveBeenCalledWith({
        id: 'o2',
        patch: { ongoing: true, recurring: null },
      })
    })

    it('switching an ongoing task back to Task clears the flag', () => {
      tasksData = [makeTask({ id: 'o3', text: 'thesis', ongoing: true })]
      renderList()

      fireEvent.click(screen.getByText('thesis'))
      fireEvent.click(screen.getByRole('button', { name: 'Task' }))

      expect(updateMutate).toHaveBeenCalledWith({ id: 'o3', patch: { ongoing: false } })
    })

    it('the ✓ on an ongoing task archives it (done), never a recurring cycle bump', () => {
      tasksData = [makeTask({ id: 'o4', text: 'learn spanish', bucket: 'oneoff', ongoing: true })]
      renderList()

      fireEvent.click(screen.getByLabelText('Mark done'))

      // Ongoing done = archived to the Done log, exactly like a one-off — no recurring patch.
      expect(updateMutate).not.toHaveBeenCalled()
      expect(markDoneMutate).toHaveBeenCalledWith({
        taskId: 'o4',
        text: 'learn spanish',
        bucket: 'oneoff',
        timeZone: 'UTC',
      })
    })
  })
})

// The per-quadrant focus scope behind the mobile overview→focus flow. One placed task per
// quadrant lets us assert that `quadrantFilter` renders exactly its quadrant (split at 0.5,
// boundary on the HIGH side) and nothing else, while leaving the unfiltered list unchanged.
describe('ListView quadrantFilter', () => {
  const quadrantTasks: Task[] = [
    makeTask({ id: 'dn', text: 'do now task', x: 0.9, y: 0.9 }), // urgent + important
    makeTask({ id: 'sc', text: 'schedule task', x: 0.1, y: 0.9 }), // important, not urgent
    makeTask({ id: 'er', text: 'errand task', x: 0.9, y: 0.1 }), // urgent, not important
    makeTask({ id: 'sd', text: 'someday task', x: 0.1, y: 0.1 }), // neither
  ]

  it('renders only tasks in the given quadrant', () => {
    tasksData = quadrantTasks
    renderList({ quadrantFilter: 'schedule' })

    expect(screen.getByText('schedule task')).toBeInTheDocument()
    expect(screen.queryByText('do now task')).not.toBeInTheDocument()
    expect(screen.queryByText('errand task')).not.toBeInTheDocument()
    expect(screen.queryByText('someday task')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('leaves the unfiltered list showing every quadrant (default behavior unchanged)', () => {
    tasksData = quadrantTasks
    renderList()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('ranks within the filtered quadrant by score descending', () => {
    // Two Do Now tasks; the higher-scoring one ranks first WITHIN the quadrant (rank restarts at 1).
    tasksData = [
      makeTask({ id: 'dn-lo', text: 'do now lower', x: 0.55, y: 0.55 }),
      makeTask({ id: 'dn-hi', text: 'do now higher', x: 0.99, y: 0.99 }),
      makeTask({ id: 'sc', text: 'schedule task', x: 0.1, y: 0.9 }),
    ]
    renderList({ quadrantFilter: 'do-now' })

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText('do now higher')).toBeInTheDocument()
    expect(within(items[0]!).getByLabelText('Rank 1')).toBeInTheDocument()
    expect(within(items[1]!).getByText('do now lower')).toBeInTheDocument()
    expect(within(items[1]!).getByLabelText('Rank 2')).toBeInTheDocument()
  })

  it('excludes staged (unplaced) tasks from a quadrant-scoped view', () => {
    // A staged task has no real quadrant even though its default (0.5, 0.5) would fall in Do Now.
    tasksData = [
      makeTask({ id: 'placed', text: 'placed do-now', x: 0.9, y: 0.9 }),
      makeTask({ id: 'staged', text: 'staged task', x: null, y: null, staged: true }),
    ]
    renderList({ quadrantFilter: 'do-now' })

    expect(screen.getByText('placed do-now')).toBeInTheDocument()
    expect(screen.queryByText('staged task')).not.toBeInTheDocument()
  })

  it('shows a quadrant-scoped empty state when the quadrant has no tasks', () => {
    tasksData = [makeTask({ id: 'dn', text: 'do now task', x: 0.9, y: 0.9 })]
    renderList({ quadrantFilter: 'someday' })

    expect(screen.getByText(/Nothing in this quadrant yet/i)).toBeInTheDocument()
    expect(screen.queryByText('do now task')).not.toBeInTheDocument()
  })
})

describe('paused (start-later) tasks', () => {
  // isDormant compares wall-clock dates against the real clock here (ListView passes no test
  // seam), so the fixtures use unambiguous far-future / far-past start dates.

  it('a dormant task leaves the ranking and lives in the collapsed Paused strip', () => {
    tasksData = [
      makeTask({ id: 'live', text: 'Live task' }),
      makeTask({ id: 'p1', text: 'Paused project', start_date: '2999-01-01' }),
    ]
    renderList()
    // Out of the ranked list, hidden behind the collapsed strip header…
    expect(screen.queryByText('Paused project')).toBeNull()
    const header = screen.getByRole('button', { name: /Paused · 1/ })
    // …and revealed (with its return date) when the strip expands.
    fireEvent.click(header)
    expect(screen.getByText('Paused project')).toBeInTheDocument()
    expect(screen.getByText(/returns/)).toBeInTheDocument()
  })

  it('Resume clears start_date (the task wakes at its stored spot)', () => {
    tasksData = [makeTask({ id: 'p1', text: 'Paused project', start_date: '2999-01-01' })]
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Paused · 1/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Resume Paused project' }))
    expect(updateMutate).toHaveBeenCalledWith({ id: 'p1', patch: { start_date: null } })
  })

  it('a past start date is just a live task — ranked normally, no strip', () => {
    tasksData = [makeTask({ id: 't1', text: 'Started long ago', start_date: '2000-01-01' })]
    renderList()
    expect(screen.getByText('Started long ago')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Paused ·/ })).toBeNull()
  })

  it('the strip still renders when EVERY task is paused (else pausing reads as deletion)', () => {
    tasksData = [makeTask({ id: 'p1', text: 'Only paused', start_date: '2999-01-01' })]
    renderList()
    expect(screen.getByText(/No tasks yet|Nothing in this quadrant/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Paused · 1/ })).toBeInTheDocument()
  })

  it('a quadrant focus list scopes dormant tasks out and never shows the strip', () => {
    tasksData = [
      makeTask({ id: 'live', text: 'Live task', x: 0.9, y: 0.9 }),
      makeTask({ id: 'p1', text: 'Paused project', start_date: '2999-01-01', x: 0.9, y: 0.9 }),
    ]
    renderList({ quadrantFilter: 'do-now' })
    expect(screen.getByText('Live task')).toBeInTheDocument()
    expect(screen.queryByText('Paused project')).toBeNull()
    expect(screen.queryByRole('button', { name: /Paused ·/ })).toBeNull()
  })
})
