import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

// Viewport-aware positioning for a PORTALED popover anchored to a trigger element — the shared
// half of the "ClusterPopup playbook" (prefer below, flip above when there's more room, clamp
// on-screen, cap height so cramped viewports scroll internally). Used by the grid card's ⋯
// schedule menu and each cluster-popup row's ⋯ schedule menu; extracted when the second consumer
// appeared so a flip/clamp fix can never drift between them.
//
// Call `position()` from the OPEN handler (measure-then-setState belongs in the event handler,
// not an effect — the react-hooks/set-state-in-effect rule), then render from `pos`. While
// `open`, window scroll (capture — overlays scroll their own boxes) and resize re-anchor it.

export interface AnchoredMenuPos {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
}

export function useAnchoredMenu(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  opts: { width: number; maxHeight: number; gap?: number; margin?: number },
): { pos: AnchoredMenuPos | null; position: () => void } {
  const { width, maxHeight, gap = 6, margin = 8 } = opts
  const [pos, setPos] = useState<AnchoredMenuPos | null>(null)

  const position = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Right-align the panel to the trigger, then keep the whole width on-screen.
    const left = Math.max(margin, Math.min(rect.right - width, vw - width - margin))
    const spaceBelow = vh - rect.bottom - gap - margin
    const spaceAbove = rect.top - gap - margin
    const flipAbove = spaceBelow < Math.min(maxHeight, spaceAbove) && spaceAbove > spaceBelow
    if (flipAbove) {
      setPos({
        left,
        bottom: vh - rect.top + gap,
        maxHeight: Math.max(0, Math.min(maxHeight, spaceAbove)),
      })
    } else {
      setPos({
        left,
        top: rect.bottom + gap,
        maxHeight: Math.max(0, Math.min(maxHeight, spaceBelow)),
      })
    }
  }, [anchorRef, width, maxHeight, gap, margin])

  useEffect(() => {
    if (!open) return
    window.addEventListener('scroll', position, true)
    window.addEventListener('resize', position)
    return () => {
      window.removeEventListener('scroll', position, true)
      window.removeEventListener('resize', position)
    }
  }, [open, position])

  return { pos, position }
}
