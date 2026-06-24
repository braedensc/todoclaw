import type { PointerEvent } from 'react'
import type { Task } from '../../types/task'

export interface StagingTrayProps {
  tasks: Task[]
  /** Whether tap-to-place is the active interaction (mobile / touch). */
  tapToPlace: boolean
  /** The tray task currently selected for tap-to-place, if any. */
  placingId: string | null
  /** Desktop: pointer-down on a tray card begins a drag onto the grid (from useFreeDrag). */
  onCardPointerDown: (id: string) => (event: PointerEvent) => void
  /** Mobile: tap a tray card to select it for placement (toggles placingId). */
  onSelectForPlacement: (id: string) => void
}

/**
 * The staging tray: tasks with `staged === true` that have no grid position yet. New tasks
 * (created from the header "Add a task" input) land here. From here a task reaches the grid
 * via desktop drag (useFreeDrag) or mobile tap-select → tap-on-grid. Placement itself is
 * committed by GridView; this panel only renders + initiates the interaction.
 */
export function StagingTray({
  tasks,
  tapToPlace,
  placingId,
  onCardPointerDown,
  onSelectForPlacement,
}: StagingTrayProps) {
  return (
    <aside
      aria-label="Staging tray"
      className="rounded-xl border border-border-strong bg-panel p-3"
    >
      <h2 className="mb-2 text-sm font-semibold text-ink">
        Staging tray
        <span className="ml-1 text-xs font-normal text-muted">({tasks.length})</span>
      </h2>

      {tasks.length === 0 ? (
        <p className="text-xs text-muted">Tray empty — add a task above.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tasks.map((task) => {
            const selected = placingId === task.id
            return (
              <li key={task.id}>
                <button
                  type="button"
                  data-testid="tray-card"
                  data-task-id={task.id}
                  // Desktop drag begins on pointer-down; tap-to-place selects on click.
                  onPointerDown={tapToPlace ? undefined : onCardPointerDown(task.id)}
                  onClick={tapToPlace ? () => onSelectForPlacement(task.id) : undefined}
                  aria-pressed={tapToPlace ? selected : undefined}
                  style={{ touchAction: 'none' }}
                  className={[
                    'w-full rounded-lg border bg-card px-3 py-2 text-left text-xs text-ink shadow-sm',
                    tapToPlace ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
                    selected ? 'border-primary ring-2 ring-primary' : 'border-border',
                  ].join(' ')}
                >
                  <span className="break-words leading-snug">{task.text}</span>
                  {selected && (
                    <span className="mt-1 block text-[10px] font-semibold text-primary">
                      Tap a spot on the grid to place
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}
