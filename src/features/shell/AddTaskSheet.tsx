import { useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { quadrantMeta, type QuadrantKey } from '../../lib/quadrants'
import { QUADRANT_ORDER, QUADRANT_CENTER, QUADRANT_SUBTITLE } from '../../lib/quadrant-summary'
import { QUADRANT_TINT } from '../grid/grid-constants'
import { BottomSheet } from '../../components/BottomSheet'

// AddTaskSheet — create a task already PLACED in a quadrant (mobile create-into-quadrant, Concept
// C). A text field plus a 2×2 quadrant picker, pre-selected to the current focus quadrant when
// there is one. On submit the caller drops the task at that quadrant's center (collision-resolved)
// with staged:false — so a phone user never has to switch to the Grid view just to add.
//
// The stateful form is a CHILD of BottomSheet, which renders nothing while closed — so the form
// remounts on each open and its useState initializers reset the draft + re-seed the quadrant, with
// no reset-in-effect.

function display(key: QuadrantKey) {
  const c = QUADRANT_CENTER[key]
  return quadrantMeta(c.x, c.y)
}

export function AddTaskSheet({
  open,
  defaultQuadrant,
  onAdd,
  onClose,
}: {
  open: boolean
  /** Quadrant pre-selected when the sheet opens (the focused quadrant), or null from the overview. */
  defaultQuadrant: QuadrantKey | null
  onAdd: (text: string, dest: QuadrantKey) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <BottomSheet open={open} onClose={onClose} title="Add a task" initialFocusRef={inputRef}>
      <AddTaskForm defaultQuadrant={defaultQuadrant} onAdd={onAdd} inputRef={inputRef} />
    </BottomSheet>
  )
}

function AddTaskForm({
  defaultQuadrant,
  onAdd,
  inputRef,
}: {
  defaultQuadrant: QuadrantKey | null
  onAdd: (text: string, dest: QuadrantKey) => void
  inputRef: RefObject<HTMLInputElement>
}) {
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<QuadrantKey | null>(defaultQuadrant)

  const canAdd = text.trim().length > 0 && selected != null

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canAdd || selected == null) return
    onAdd(text.trim(), selected)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-label="Task text"
        placeholder="What needs doing?"
        className="w-full rounded-xl border border-border-strong bg-card px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted-light focus:border-primary"
      />

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-light">
          Which quadrant?
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          {QUADRANT_ORDER.map((key) => {
            const m = display(key)
            const on = key === selected
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                aria-pressed={on}
                aria-label={m.label}
                className={
                  'flex min-h-[62px] flex-col gap-0.5 rounded-2xl border border-border-strong p-3 text-left transition ' +
                  (on ? '' : 'opacity-70')
                }
                style={{
                  borderLeft: `4px solid ${m.color}`,
                  background: QUADRANT_TINT[key],
                  ...(on ? { boxShadow: `0 0 0 2px ${m.color}` } : {}),
                }}
              >
                <span className="font-serif text-sm font-semibold" style={{ color: m.color }}>
                  {m.label}
                </span>
                <span className="text-[10px] text-muted-light">{QUADRANT_SUBTITLE[key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={!canAdd}
        className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50"
      >
        Add task
      </button>
    </form>
  )
}
