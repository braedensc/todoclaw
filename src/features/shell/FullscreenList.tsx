import { ViewToggle } from '../../components/ViewToggle'
import type { WorkView } from '../../components/tabs'
import { ListView } from '../list/ListView'

interface FullscreenListProps {
  view: WorkView
  onSelectView: (view: WorkView) => void
  onExitFullscreen: () => void
}

/**
 * The List view shown at FULL SIZE inside the fullscreen overlay — the same frame the expanded
 * grid uses (GridSurface). Reached by expanding the grid and toggling to List; the Grid⇄List
 * toggle and the exit-fullscreen control stay available, so switching back to Grid keeps
 * fullscreen and either view can leave it. Previously picking List while expanded collapsed all
 * the way back to the inline main page — now it stays in the overlay.
 *
 * The list is a centred, large reading column (long lists scroll — the overlay is `overflow-auto`)
 * rather than an edge-to-edge stretch; a full-bleed row of sliders reads poorly. The chrome mirrors
 * GridSurface's expanded branch (fixed bg-bg overlay, toggle notched into the top border, ⤡ exit).
 */
export function FullscreenList({ view, onSelectView, onExitFullscreen }: FullscreenListProps) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center overflow-auto bg-bg px-4 py-8">
      <div className="relative mx-auto w-full max-w-4xl">
        {/* Grid⇄List toggle — notched into the list panel's top border (matches the grid). */}
        <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
          <ViewToggle view={view} onSelect={onSelectView} />
        </div>

        {/* Exit fullscreen — the same control the expanded grid uses. */}
        <button
          type="button"
          onClick={onExitFullscreen}
          aria-label="Exit fullscreen list"
          title="Exit fullscreen"
          className="absolute right-1.5 top-1.5 z-20 flex h-[22px] w-[22px] items-center justify-center rounded-md border border-border-strong bg-panel text-[13px] leading-none text-muted shadow-sm hover:bg-card hover:text-ink"
        >
          ⤡
        </button>

        <ListView />
      </div>
    </div>
  )
}
