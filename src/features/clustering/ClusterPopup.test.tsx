import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ClusterPopup } from './ClusterPopup'
import type { Task } from '../../types/task'
import type { Recurring } from '../../types/task'

// A folded task inside an open cluster popup should read like its grid card: an overdue/near-due
// one-off carries the SAME warm tint (urgencyGlowStyle().background) as the card, while a task with
// no due date — or a recurring one (which owns its status color) — stays on the plain paper fill.

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    user_id: 'u1',
    text: `Task ${id}`,
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    created_at: '2026-07-01T00:00:00Z',
    deleted_at: null,
    completed_at: null,
    ...over,
  }
}

const recurring: Recurring = { frequencyDays: 7, lastDoneAt: null, doneCount: 0 }

function renderPopup(group: Task[]) {
  const anchorRef = createRef<HTMLElement>()
  render(
    <ClusterPopup
      group={group}
      accentColor="#bf5e2a"
      anchorRef={anchorRef}
      reflowKey={0}
      timeZone="UTC"
      editingId={null}
      onStartEdit={vi.fn()}
      onStopEdit={vi.fn()}
      onRename={vi.fn()}
      onDone={vi.fn()}
      onDelete={vi.fn()}
      onRowPointerDown={() => vi.fn()}
    />,
  )
  // Portaled to <body>, so query the document rather than the render container.
  const row = (id: string) =>
    document.querySelector<HTMLElement>(`[data-testid="cluster-popup-row"][data-task-id="${id}"]`)
  return { row }
}

describe('ClusterPopup row urgency tint', () => {
  it('tints an overdue one-off row and leaves an undated row on plain paper', () => {
    // '2026-07-01' is permanently in the past → always overdue relative to "now".
    const { row } = renderPopup([task('over', { due: '2026-07-01' }), task('plain')])
    expect(row('over')?.style.background).toBeTruthy()
    expect(row('plain')?.style.background).toBe('')
  })

  it('does not tint a recurring row (it carries its own status color)', () => {
    // Even overdue-on-cadence, a recurring task takes no urgency tier here.
    const { row } = renderPopup([task('rec', { due: '2026-07-01', recurring })])
    expect(row('rec')?.style.background).toBe('')
  })
})
