import type { GridApi } from './use-grid'
import { BUCKET_DOT } from './grid-constants'

// Staging chips, folded into the Manual add widget (B8 — replaces the old right-column
// StagingTray). Newly added Manual tasks land here with `staged: true`; from here a task reaches
// the grid by desktop drag (startTrayDrag → the grid canvas) or mobile tap-select → tap-on-grid.
// Staging is Manual-ONLY and lives inline under the input row.
//
// `canPlace` is true only while the Grid canvas is mounted (Grid view). In List view there is no
// canvas to drop onto, so chips render as quiet, non-interactive reminders (the staged tasks also
// appear as List rows with a "staging" badge, placeable via the row sliders there).
//
// Chips keep `data-testid="tray-card"` + `data-task-id` and the aria-pressed tap-select state so
// the golden E2E drag/tap-place flows are unchanged by the relocation.

export function StagingBar({ grid, canPlace }: { grid: GridApi; canPlace: boolean }) {
  const { stagedTasks, isMobile, placingId, togglePlacing, startTrayDrag } = grid

  if (stagedTasks.length === 0) return null

  const tapToPlace = canPlace && isMobile
  const dragToPlace = canPlace && !isMobile

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-muted-light">Staging</span>
      {stagedTasks.map((task) => {
        const selected = placingId === task.id
        return (
          <button
            key={task.id}
            type="button"
            data-testid="tray-card"
            data-task-id={task.id}
            onPointerDown={dragToPlace ? startTrayDrag(task.id) : undefined}
            onClick={tapToPlace ? () => togglePlacing(task.id) : undefined}
            aria-pressed={tapToPlace ? selected : undefined}
            style={{ touchAction: 'none', borderLeftWidth: 3, borderLeftColor: BUCKET_DOT }}
            className={[
              'rounded border border-border-strong bg-card px-2 py-1 text-left text-[11px] text-ink',
              dragToPlace ? 'cursor-grab active:cursor-grabbing' : '',
              tapToPlace ? 'cursor-pointer' : '',
              !canPlace ? 'cursor-default' : '',
              selected ? 'ring-2 ring-primary' : '',
            ].join(' ')}
          >
            <span className="break-words">{task.text}</span>
            {selected && (
              <span className="ml-1 font-semibold text-primary">· tap the grid to place</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
