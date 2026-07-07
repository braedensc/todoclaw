import { useRef, useState } from 'react'
import { useTasks, useAddTask } from '../tasks/use-tasks'
import type { QuadrantKey } from '../../lib/quadrants'
import { placeInQuadrant } from '../../lib/quadrant-summary'
import type { ChatController } from '../ai/use-chat-controller'
import { BottomSheet } from '../../components/BottomSheet'
import { BabyClawInput } from './TaskInputWidget'
import { AddTaskForm } from './AddTaskSheet'

// MobileAddSheet — the single mobile "add a task" surface, opened by the bottom nav's "+". On a
// phone there is no grid to place into, so the two capture paths both produce a PLACED task:
//   • BabyClaw (default) — natural language; the assistant sets placement (e.g. "urgent + important").
//   • Manual — a text field + quadrant picker (AddTaskForm); we drop it at that quadrant's center
//     (collision-resolved) with staged:false.
// Reuses the exact BabyClawInput and manual AddTaskForm so there's one implementation of each.

type AddMode = 'babyclaw' | 'manual'

export function MobileAddSheet({
  open,
  onClose,
  chat,
  onOpenChat,
}: {
  open: boolean
  onClose: () => void
  chat: ChatController
  onOpenChat: () => void
}) {
  const [mode, setMode] = useState<AddMode>('babyclaw')
  const { data: tasks } = useTasks()
  const addTask = useAddTask()
  const manualInputRef = useRef<HTMLInputElement>(null)

  // Manual add → placed task. Collision-resolve the quadrant center against existing placed tasks.
  const handleManualAdd = (text: string, dest: QuadrantKey) => {
    const placed = (tasks ?? []).filter((t) => !t.staged)
    const { x, y } = placeInQuadrant(dest, placed)
    addTask.mutate({ text, x, y, staged: false })
    onClose()
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Add a task"
      initialFocusRef={mode === 'manual' ? manualInputRef : undefined}
    >
      {/* Add-mode toggle — BabyClaw (natural language) vs Manual (text + quadrant). */}
      <div
        role="group"
        aria-label="Add mode"
        className="mb-3 flex gap-1 rounded-xl border border-border bg-panel p-1"
      >
        {(
          [
            { id: 'babyclaw', label: 'BabyClaw', icon: '🐾' },
            { id: 'manual', label: 'Manual', icon: '✎' },
          ] as const
        ).map((m) => {
          const on = mode === m.id
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={on}
              className={
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ' +
                (on ? 'bg-card text-ink shadow-sm' : 'text-muted hover:text-ink')
              }
            >
              <span aria-hidden>{m.icon}</span>
              {m.label}
            </button>
          )
        })}
      </div>

      {mode === 'babyclaw' ? (
        <BabyClawInput chat={chat} onOpenChat={onOpenChat} />
      ) : (
        <AddTaskForm defaultQuadrant={null} onAdd={handleManualAdd} inputRef={manualInputRef} />
      )}
    </BottomSheet>
  )
}
