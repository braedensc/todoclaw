import { useEffect, useRef } from 'react'

// The pre-auth mascot: TodoClaw peeking over the top edge of the sign-in card (style mix,
// login pass). Same drawing + geometry as components/TodoClawPeek's ledge-less variant —
// chin clipped at y=42.2 of the 64-unit viewBox so the card border reads as the edge he's
// hiding behind — but interactive, which is why it's its own component rather than a prop
// on the static mark:
//  - his eyes follow the cursor (direct DOM writes on [data-pupil], no re-renders; skipped
//    under prefers-reduced-motion)
//  - he blinks (.tc-eye-blink, src/index.css)
//  - while any password input has focus he covers his eyes with his paws (.auth-mascot.shy,
//    src/index.css) — document-level focusin/focusout, so the forms need no wiring and the
//    redeem form's password field gets the same peekaboo for free.
// Purely decorative: aria-hidden, and the parent positions it pointer-events-none.
export function AuthMascot({ className }: { className?: string }) {
  const rootRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const pupils = Array.from(root.querySelectorAll<SVGGElement>('g[data-pupil]'))
    // Guarded: jsdom (App.test) has no matchMedia; treat that as "no reduced-motion set".
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const isPassword = (t: EventTarget | null): t is HTMLInputElement =>
      t instanceof HTMLInputElement && t.type === 'password'
    const setShy = (on: boolean) => {
      root.classList.toggle('shy', on)
      // Recenter his gaze while covered so the eyes are straight when the paws drop.
      if (on) pupils.forEach((p) => (p.style.transform = ''))
    }
    const onFocusIn = (e: FocusEvent) => {
      if (isPassword(e.target)) setShy(true)
    }
    const onFocusOut = (e: FocusEvent) => {
      if (isPassword(e.target)) setShy(false)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    let onMove: ((e: MouseEvent) => void) | undefined
    if (!reduce) {
      onMove = (e) => {
        if (root.classList.contains('shy')) return
        const r = root.getBoundingClientRect()
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        const d = Math.hypot(dx, dy) || 1
        const m = Math.min(d / 70, 1) * 2.3
        const t = `translate(${((dx / d) * m).toFixed(2)}px, ${((dy / d) * m).toFixed(2)}px)`
        pupils.forEach((p) => (p.style.transform = t))
      }
      document.addEventListener('mousemove', onMove)
    }

    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      if (onMove) document.removeEventListener('mousemove', onMove)
    }
  }, [])

  return (
    <svg
      ref={rootRef}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={'auth-mascot ' + (className ?? '')}
    >
      <defs>
        <clipPath id="auth-mascot-clip">
          <rect x="0" y="0" width="64" height="42.2" />
        </clipPath>
      </defs>
      <g clipPath="url(#auth-mascot-clip)">
        <path
          d="M21,14 C11,15 6,28 12,38 C15,43 20,41 20.5,32 C21,25 21.5,18 23,15 Z"
          fill="#b3a488"
          stroke="#2e2a24"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M43,14 C53,15 58,28 52,38 C49,43 44,41 43.5,32 C43,25 42.5,18 41,15 Z"
          fill="#b3a488"
          stroke="#2e2a24"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="30" r="17" fill="#f8f2e6" stroke="#2e2a24" strokeWidth="1.5" />
        <path
          d="M27.5,13.5 q2.2,-3.2 4.4,-0.4 q1.8,-2.8 3.6,0.2"
          fill="none"
          stroke="#2e2a24"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M21.5,23.5 q3,-2 6,-1 M36.5,22.5 q3,-1 6,1"
          fill="none"
          stroke="#2e2a24"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity="0.6"
        />
        <g className="tc-eye-blink">
          <g data-pupil>
            <circle cx="25" cy="29" r="3.5" fill="#5f8aa3" />
            <circle cx="23.8" cy="27.7" r="1" fill="#fff" />
          </g>
        </g>
        <g className="tc-eye-blink">
          <g data-pupil>
            <circle cx="39" cy="29" r="3.5" fill="#5f8aa3" />
            <circle cx="37.8" cy="27.7" r="1" fill="#fff" />
          </g>
        </g>
      </g>
      {/* Nose + paws draw after (outside) the clip so they overhang the card edge. */}
      <ellipse cx="32" cy="41.5" rx="4.2" ry="3.2" fill="#2e2a24" />
      <circle cx="30.8" cy="40.4" r="0.9" fill="#f8f2e6" opacity="0.85" />
      <g className="paw paw-l">
        <rect
          x="14.5"
          y="39.5"
          width="10"
          height="9.5"
          rx="4.5"
          fill="#f8f2e6"
          stroke="#2e2a24"
          strokeWidth="1.5"
        />
        <path
          d="M17.8,44.5 v3.4 M21.2,44.5 v3.4"
          stroke="#2e2a24"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M16.2,49.4 l0.8,2 M19.5,49.8 l0.3,2.2 M22.8,49.4 l-0.4,2.1"
          stroke="#2e2a24"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
      <g className="paw paw-r">
        <rect
          x="39.5"
          y="39.5"
          width="10"
          height="9.5"
          rx="4.5"
          fill="#f8f2e6"
          stroke="#2e2a24"
          strokeWidth="1.5"
        />
        <path
          d="M42.8,44.5 v3.4 M46.2,44.5 v3.4"
          stroke="#2e2a24"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M41.2,49.4 l0.8,2 M44.5,49.8 l0.3,2.2 M47.8,49.4 l-0.4,2.1"
          stroke="#2e2a24"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}
