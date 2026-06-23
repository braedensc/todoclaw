import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskList } from './TaskList'

// Smoke test: mock the data hooks so the component renders without Supabase/network.
// Proves the RTL + jsdom + React 18 harness works end to end.
vi.mock('./use-tasks', () => ({
  useTasks: () => ({ data: [], isLoading: false, isError: false, error: null }),
  useAddTask: () => ({ mutate: vi.fn(), isPending: false }),
  useSoftDeleteTask: () => ({ mutate: vi.fn() }),
}))

describe('TaskList', () => {
  it('renders the add-task form and the empty state', () => {
    render(<TaskList />)
    expect(screen.getByPlaceholderText('Add a task…')).toBeInTheDocument()
    expect(screen.getByText('No tasks yet — add one above.')).toBeInTheDocument()
  })
})
