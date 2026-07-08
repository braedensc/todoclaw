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
// Rendered as a FULL-SCREEN sheet (BottomSheet fullScreen): the whole form is bottom-clustered in
// the thumb zone — quadrant picker directly above the text-input + Add composer row (just above
// the on-screen keyboard). BottomSheet owns dvh sizing + safe-area insets, and its body scrolls
// internally if the keyboard compresses the viewport — the page itself never scrolls.
//
// `defaultQuadrant` pre-selects the quadrant the user is already looking at (the focused quadrant
// from use-quadrant-focus) — adding from inside "Do Now" shouldn't make you re-pick Do Now. It's
// read on each open (the form remounts, BottomSheet renders nothing while closed). `onAdded`
// reports the destination up so App can flash the "Added to …" confirmation (the sheet closes
// instantly, and the new task may land in a quadrant you can't see).

export function MobileAddSheet({
  open,
  defaultQuadrant,
  onAdded,
  onClose,
}: {
  open: boolean
  defaultQuadrant: QuadrantKey | null
  onAdded?: (dest: QuadrantKey) => void
  onClose: () => void
}) {
  const { data: tasks } = useTasks()
  const addTask = useAddTask()
  const inputRef = useRef<HTMLInputElement>(null)

  // Manual add → placed task. Collision-resolve the quadrant center against existing placed tasks.
  const handleManualAdd = (text: string, dest: QuadrantKey) => {
    const placed = (tasks ?? []).filter((t) => !t.staged)
    const { x, y } = placeInQuadrant(dest, placed)
    addTask.mutate({ text, x, y, staged: false })
    onAdded?.(dest)
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
      <AddTaskForm defaultQuadrant={defaultQuadrant} onAdd={handleManualAdd} inputRef={inputRef} />
    </BottomSheet>
  )
}
