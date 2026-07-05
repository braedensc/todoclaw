import type { Task } from '../../types/task'
import type { GridApi } from '../grid/use-grid'
import { BUCKET_DOT } from '../grid/grid-constants'

// Card-in-place (B2): a just-added Manual task doesn't drop into a staging tray — it materializes
// right where the input was, as a draggable "Drag new item to grid" card. Drag it onto the canvas
// (desktop) or tap-select then tap the grid (mobile) and it becomes a placed GridCard; once the
// pending card leaves, the input returns for the next add (one todo at a time).
//
// The drag/tap mechanics are the SAME ones the grid uses (grid.startNewCardDrag materializes the
// card under the pointer via use-grid's shared move handler; grid.togglePlacing arms a mobile
// tap-to-place). `canPlace` is true only while the Grid canvas is mounted; in List view the cards
// render as quiet reminders (the same tasks also show as List rows, placeable via the sliders).

interface NewItemStripProps {
  pending: Task[]
  grid: GridApi
  canPlace: boolean
}

export function NewItemStrip({ pending, grid, canPlace }: NewItemStripProps) {
  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium text-muted-light">
        {canPlace ? (
          <>
            Drag {pending.length > 1 ? 'onto the grid' : 'new item to grid'}{' '}
            <span aria-hidden>↗</span>
          </>
        ) : (
          'New — switch to Grid to place'
        )}
      </span>
      {pending.map((task) => (
        <NewItemCard key={task.id} task={task} grid={grid} canPlace={canPlace} />
      ))}
    </div>
  )
}

function NewItemCard({ task, grid, canPlace }: { task: Task; grid: GridApi; canPlace: boolean }) {
  const { isMobile, placingId, togglePlacing, startNewCardDrag } = grid
  const tapToPlace = canPlace && isMobile
  const dragToPlace = canPlace && !isMobile
  const selected = placingId === task.id

  return (
    <div
      data-testid="new-item-card"
      data-task-id={task.id}
      onPointerDown={dragToPlace ? startNewCardDrag(task.id) : undefined}
      onClick={tapToPlace ? () => togglePlacing(task.id) : undefined}
      aria-pressed={tapToPlace ? selected : undefined}
      style={{
        touchAction: 'none',
        borderTopWidth: 3,
        borderTopColor: BUCKET_DOT,
      }}
      className={[
        'max-w-[220px] rounded-lg border border-border-strong bg-card px-2 py-1 text-left text-[11px] text-ink shadow-sm',
        dragToPlace ? 'cursor-grab active:cursor-grabbing' : '',
        tapToPlace ? 'cursor-pointer' : '',
        !canPlace ? 'cursor-default' : '',
        selected ? 'ring-2 ring-primary' : '',
      ].join(' ')}
    >
      <span className="break-words font-medium leading-tight">{task.text}</span>
      {selected ? (
        <span className="mt-0.5 block text-[9.5px] font-semibold text-primary">
          tap the grid to place
        </span>
      ) : (
        canPlace && (
          <span className="mt-0.5 block text-[9px] uppercase tracking-wide text-muted-light">
            <span aria-hidden>{dragToPlace ? '⤢ drag to grid' : 'tap to place'}</span>
          </span>
        )
      )}
    </div>
  )
}
