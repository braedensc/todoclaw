import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfirmProvider } from '../../components/use-confirm'
import type { Habit } from '../../types/habit'

// Mock the data hooks (mirrors DoneView.test) so HabitsView renders under jsdom with no
// Supabase. Each test overrides the per-hook return below. The toggle/update/add/delete
// mutations are plain spies we assert against.
//
// HabitsView is the SETUP page: management only, NO daily checkboxes (habits are ticked off from
// the home screen — see RemindersInline.test for the check-off behavior). So these tests cover
// add/remove habit, activate queued, and add/remove details — not toggling.
const habitsMock = vi.fn()
const dailyMock = vi.fn()
const addMutate = vi.fn()
const updateMutate = vi.fn()
const deleteMutate = vi.fn()
const toggleMutate = vi.fn()

// Structural mutations expose isPending + variables so HabitsView can derive a PER-ROW busy
// (the pending habit id) — a mutation on one habit must not disable every other row. Tests flip
// these to simulate an in-flight edit; beforeEach resets them.
let updatePending = false
let updateVariables: { id: string } | undefined
let deletePending = false
let deleteVariables: string | undefined

vi.mock('./use-habits', () => ({
  useHabits: () => habitsMock(),
  useAddHabit: () => ({ mutate: addMutate, isPending: false }),
  useUpdateHabit: () => ({
    mutate: updateMutate,
    isPending: updatePending,
    variables: updateVariables,
  }),
  useSoftDeleteHabit: () => ({
    mutate: deleteMutate,
    isPending: deletePending,
    variables: deleteVariables,
  }),
  useToggleDailyFlag: () => ({ mutate: toggleMutate, isPending: false }),
}))
vi.mock('../daily-state/use-daily-state', () => ({
  useDailyState: () => dailyMock(),
}))
vi.mock('../schedule/use-user-schedule', () => ({
  useUserSchedule: () => ({ data: { timezone: 'America/New_York' } }),
}))

import { HabitsView } from './HabitsView'

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    user_id: 'u1',
    text: 'Wrist strengthening routine',
    active: true,
    subtasks: [{ id: 's1', text: 'Rice bucket — 3 sets each direction' }],
    created_at: '2026-06-23T00:00:00.000Z',
    deleted_at: null,
    ...over,
  }
}

function setHabits(habits: Habit[]) {
  habitsMock.mockReturnValue({ data: habits, isLoading: false, isError: false })
}

// HabitsView now calls useConfirm() on every render, so it must be wrapped in a ConfirmProvider.
function renderView() {
  return render(
    <ConfirmProvider>
      <HabitsView />
    </ConfirmProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  updatePending = false
  updateVariables = undefined
  deletePending = false
  deleteVariables = undefined
  dailyMock.mockReturnValue({ data: { done: {}, done_at: {}, habit_done: {}, subtask_done: {} } })
})

describe('HabitsView', () => {
  it('shows the empty state when there are no habits', () => {
    setHabits([])
    renderView()
    expect(screen.getByText(/No habits yet/i)).toBeInTheDocument()
  })

  it('does NOT render a daily checkbox on the setup page (habits are checked from home)', () => {
    setHabits([habit()])
    renderView()
    // The row shows the name + its management controls, but no habit/detail checkboxes.
    expect(screen.getByText('Wrist strengthening routine')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: /Mark "Wrist strengthening routine" done today/i }),
    ).not.toBeInTheDocument()
  })

  it('renders a details toggle and a clear Remove button for each active habit', () => {
    setHabits([habit()])
    renderView()
    expect(
      screen.getByRole('button', { name: /Show details for "Wrist strengthening routine"/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Remove habit "Wrist strengthening routine"/i }),
    ).toHaveTextContent(/Remove/i)
  })

  it('adds a detail by appending to the habit subtasks via useUpdateHabit', () => {
    setHabits([habit()])
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Show details for/i }))
    const input = screen.getByLabelText(/Add a detail to "Wrist strengthening routine"/i)
    fireEvent.change(input, { target: { value: 'Finger extensions' } })
    fireEvent.submit(input)
    expect(updateMutate).toHaveBeenCalledTimes(1)
    const arg = updateMutate.mock.calls[0]![0] as {
      id: string
      patch: { subtasks: Habit['subtasks'] }
    }
    expect(arg.id).toBe('h1')
    expect(arg.patch.subtasks).toHaveLength(2)
    expect(arg.patch.subtasks[1]!.text).toBe('Finger extensions')
  })

  it('shows the "details are optional" hint when a habit has no details', () => {
    setHabits([habit({ subtasks: [] })])
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Show details for/i }))
    expect(screen.getByText(/Details are optional/i)).toBeInTheDocument()
  })

  it('renders queued (inactive) habits as activate buttons that flip active=true', () => {
    setHabits([habit({ id: 'h2', text: 'Drink more water', active: false, subtasks: [] })])
    renderView()
    const activate = screen.getByRole('button', { name: /Activate habit "Drink more water"/i })
    fireEvent.click(activate)
    expect(updateMutate).toHaveBeenCalledWith({ id: 'h2', patch: { active: true } })
  })

  it('adds a habit via useAddHabit on submit', () => {
    setHabits([])
    renderView()
    const input = screen.getByLabelText(/Add a habit/i)
    fireEvent.change(input, { target: { value: 'Stretch' } })
    fireEvent.submit(input)
    expect(addMutate).toHaveBeenCalledWith('Stretch', expect.anything())
  })

  it('does NOT add an empty/whitespace habit', () => {
    setHabits([])
    renderView()
    const input = screen.getByLabelText(/Add a habit/i)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(input)
    expect(addMutate).not.toHaveBeenCalled()
  })

  it('removes a habit only after confirming in the dialog', async () => {
    setHabits([habit()])
    renderView()
    fireEvent.click(
      screen.getByRole('button', { name: /Remove habit "Wrist strengthening routine"/i }),
    )
    // The themed confirm dialog appears; removal fires only after its Remove button is clicked.
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Remove$/ }))
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('h1'))
  })

  it('does NOT remove when the confirm dialog is cancelled', async () => {
    setHabits([habit()])
    renderView()
    fireEvent.click(
      screen.getByRole('button', { name: /Remove habit "Wrist strengthening routine"/i }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteMutate).not.toHaveBeenCalled()
  })

  it('shows a per-detail remove inside the expanded panel', () => {
    setHabits([habit()])
    renderView()
    fireEvent.click(screen.getByRole('button', { name: /Show details for/i }))
    const detailRow = screen
      .getByText('Rice bucket — 3 sets each direction')
      .closest('li') as HTMLElement
    fireEvent.click(within(detailRow).getByRole('button', { name: /Remove detail/i }))
    expect(updateMutate).toHaveBeenCalledTimes(1)
    const arg = updateMutate.mock.calls[0]![0] as {
      id: string
      patch: { subtasks: Habit['subtasks'] }
    }
    expect(arg.patch.subtasks).toHaveLength(0)
  })

  it('scopes busy to the mutating row — an in-flight edit never disables other rows', () => {
    setHabits([habit({ id: 'h1', text: 'Alpha' }), habit({ id: 'h2', text: 'Beta' })])
    // An edit is in flight on h1 only.
    updatePending = true
    updateVariables = { id: 'h1' }
    renderView()

    // h1's structural control (remove) is disabled while its edit lands…
    expect(screen.getByRole('button', { name: /Remove habit "Alpha"/i })).toBeDisabled()
    // …but h2's is untouched (per-row busy, not a global freeze).
    expect(screen.getByRole('button', { name: /Remove habit "Beta"/i })).not.toBeDisabled()
  })
})
