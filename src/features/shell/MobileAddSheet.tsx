import { useRef } from 'react'
import { useTasks, useAddTask } from '../tasks/use-tasks'
import type { QuadrantKey } from '../../lib/quadrants'
import type { Recurring } from '../../types/task'
import { placeInQuadrant } from '../../lib/quadrant-summary'
import { BottomSheet } from '../../components/BottomSheet'
import { AddTaskForm } from './AddTaskForm'

// MobileAddSheet — the single mobile "add a task" surface, opened by the bottom nav's "+".
// Reworked (2026-07-08 feedback): a true SLIDE-UP bottom sheet, not a full-screen takeover —
// content-sized, home stays visible behind the scrim, and it dismisses like every other sheet
// (body swipe-down / scrim tap / Escape). The keyboard does NOT auto-open: BottomSheet focuses
// the panel itself (no initialFocusRef), so typing starts only when the user taps the field.
//
// The form (AddTaskForm) produces a PLACED task: text + a quadrant (framed as "how urgent +
// important?"), plus an optional Repeats schedule (daily / weekly / every N days) — dropped at
// the quadrant's center (collision-resolved) with staged:false. Manual-only by design; the form
// carries a 🐾 tip pointing at Chat (BabyClaw) as the fastest capture path, wired here to close
// this sheet and open the chat.
//
// `defaultQuadrant` pre-selects the quadrant the user is already looking at (use-quadrant-focus).
// `onAdded` reports the destination up so App can flash the "Added to …" confirmation.

export function MobileAddSheet({
  open,
  defaultQuadrant,
  onAdded,
  onOpenChat,
  onClose,
}: {
  open: boolean
  defaultQuadrant: QuadrantKey | null
  onAdded?: (dest: QuadrantKey) => void
  /** Opens the BabyClaw chat (the form's "fastest way to add" tip). */
  onOpenChat?: () => void
  onClose: () => void
}) {
  const { data: tasks } = useTasks()
  const addTask = useAddTask()
  const inputRef = useRef<HTMLInputElement>(null)

  // Manual add → placed task. Collision-resolve the quadrant center against existing placed
  // tasks; a Repeats choice ships as a fresh recurring schedule on the same insert.
  const handleAdd = (text: string, dest: QuadrantKey, recurring: Recurring | null) => {
    const placed = (tasks ?? []).filter((t) => !t.staged)
    const { x, y } = placeInQuadrant(dest, placed)
    addTask.mutate({ text, x, y, staged: false, recurring })
    onAdded?.(dest)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add a task">
      <AddTaskForm
        defaultQuadrant={defaultQuadrant}
        onAdd={handleAdd}
        inputRef={inputRef}
        onOpenChat={
          onOpenChat
            ? () => {
                onClose()
                onOpenChat()
              }
            : undefined
        }
      />
    </BottomSheet>
  )
}
