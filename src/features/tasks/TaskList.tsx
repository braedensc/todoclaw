import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAddTask, useSoftDeleteTask, useTasks } from './use-tasks'

// Stage 1 skeleton surface: list the signed-in user's live tasks, add one, soft-delete
// one. No grid / clustering yet — this only proves write -> RLS -> read end to end.
export function TaskList() {
  const tasks = useTasks()
  const addTask = useAddTask()
  const softDelete = useSoftDeleteTask()
  const [text, setText] = useState('')

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    addTask.mutate(trimmed, { onSuccess: () => setText('') })
  }

  return (
    <section className="flex flex-col gap-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task…"
          className="flex-1 rounded border border-slate-300 px-3 py-2"
        />
        <button
          type="submit"
          disabled={addTask.isPending}
          className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50"
        >
          Add
        </button>
      </form>

      {tasks.isLoading && <p className="text-slate-500">Loading tasks…</p>}
      {tasks.isError && (
        <p className="text-red-600">Failed to load tasks: {String(tasks.error)}</p>
      )}

      {tasks.data && tasks.data.length === 0 && (
        <p className="text-slate-500">No tasks yet — add one above.</p>
      )}

      <ul className="flex flex-col gap-2">
        {tasks.data?.map((task) => (
          <li
            key={task.id}
            className="flex items-center justify-between rounded border border-slate-200 px-3 py-2"
          >
            <span>{task.text}</span>
            <button
              onClick={() => softDelete.mutate(task.id)}
              className="text-sm text-slate-400 hover:text-red-600"
              aria-label={`Delete ${task.text}`}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
