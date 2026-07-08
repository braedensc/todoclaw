import { useEffect, useState } from 'react'

// Height (px) of the on-screen keyboard overlapping the layout viewport — 0 while the keyboard is
// closed or where visualViewport is unsupported (then callers just keep today's behavior).
//
// Why this exists (mobile audit §3.3): iOS does NOT shrink the layout viewport — or anything
// sized in dvh — when the keyboard opens; it overlays. A bottom-anchored composer (the chat
// input) can end up typing invisibly behind the keyboard in the standalone PWA. The visual
// viewport IS shrunk, so `innerHeight − vv.height − vv.offsetTop` is exactly the overlap to pad
// bottom-fixed UI clear by. `enabled` scopes the listeners to while the surface is open.
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const overlap = window.innerHeight - vv.height - vv.offsetTop
      setInset(Math.max(0, Math.round(overlap)))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setInset(0)
    }
  }, [enabled])

  return inset
}
