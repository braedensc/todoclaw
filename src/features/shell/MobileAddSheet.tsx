import { useRef } from 'react'
import { useTasks, useAddTask } from '../tasks/use-tasks'
import type { QuadrantKey } from '../../lib/quadrants'
import { placeInQuadrant } from '../../lib/quadrant-summary'
import { BottomSheet } from '../../components/BottomSheet'
import { AddTaskForm } from './AddTaskSheet'

// MobileAddSheet — the single mobile "add a task" surface, opened by the bottom nav's "+". On a
// phone there is no grid to place into, so the manual form produces a PLACED task: a text field +
// quadrant picker (AddTaskForm), dropped at that quadrant's center (collision-resolved) with
// staged:false.
//
// Manual-only by design. Natural-language / AI task capture lives in the Chat tab (🐾, BabyClaw
// chat) — a user who wants the assistant to phrase and place a task uses chat, so this add sheet
// stays a plain manual form. (It used to carry a BabyClaw ⇄ Manual toggle; that was dropped once
// Chat became the AI capture path. The shared BabyClawInput still powers the desktop inline widget.)
//
// Rendered as a FULL-SCREEN sheet (BottomSheet fullScreen): the quadrant picker sits up top and the
// text input + Add button form a composer row anchored to the BOTTOM edge (thumb zone, just above
// the on-screen keyboard). BottomSheet owns dvh sizing + safe-area insets, and its body scrolls
// internally if the keyboard compresses the viewport — the page itself never scrolls.

export function MobileAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: tasks } = useTasks()
  const addTask = useAddTask()
  const inputRef = useRef<HTMLInputElement>(null)

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
      fullScreen
      initialFocusRef={inputRef}
    >
      <AddTaskForm defaultQuadrant={null} onAdd={handleManualAdd} inputRef={inputRef} />
    </BottomSheet>
  )
}
