import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../../hooks/use-is-mobile'

// FeatureTour — a lightweight spotlight walkthrough (the industry-standard "product tour"
// pattern, hand-rolled: no dependency carries its weight for five steps). Each step names a
// `data-tour="…"` anchor somewhere in the mounted shell; the overlay dims everything except a
// breathing-room cutout around that element and floats a small parchment card with the step's
// copy + Back/Next/Skip. Launched from the setup guide's "See how Todoclaw works" step (and,
// with a single step, as the "Show me where" spotlight on the Task Manager widget).
//
// Robustness rules:
//  - Anchors are resolved ONCE at mount; steps whose target isn't in the DOM (a surface that
//    doesn't exist at this breakpoint) drop out silently instead of pointing at nothing.
//  - The page is NOT scroll-locked — each step scrolls its target into view, and the spotlight
//    re-measures on scroll/resize (capture-phase listener so the mobile #root scroller counts),
//    so the cutout tracks the element wherever it settles.
//  - Esc or "Skip tour" closes with completed=false; finishing the last step closes with true.

export interface TourStep {
  /** Matches a `data-tour="…"` anchor somewhere in the mounted shell. */
  target: string
  title: string
  body: string
  /** Optional bulleted list shown under `body` — each item is a bold lead-in plus its detail. */
  bullets?: { lead: string; rest: string }[]
}

interface SpotRect {
  top: number
  left: number
  width: number
  height: number
}

const PAD = 8 // breathing room between the element and the cutout edge
const CARD_W = 330 // desktop card width; position math clamps with this
const CARD_GAP = 14 // gap between the cutout and the card
const CARD_H_ESTIMATE = 190 // enough to decide above-vs-below without measuring the card

function findAnchor(target: string): HTMLElement | null {
  const el = document.querySelector(`[data-tour="${target}"]`)
  return el instanceof HTMLElement ? el : null
}

export function FeatureTour({
  steps,
  onClose,
}: {
  steps: TourStep[]
  /** `completed` is true only when the user walked through to the final step's Finish. */
  onClose: (completed: boolean) => void
}) {
  // Resolve once at mount: anchors missing at this breakpoint/route drop out silently.
  const available = useMemo(() => steps.filter((s) => findAnchor(s.target)), [steps])
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<SpotRect | null>(null)
  const isMobile = useIsMobile()
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = available[index]

  // Nothing to point at (shouldn't happen on the home shell) — close instead of a blank overlay.
  const empty = available.length === 0
  useEffect(() => {
    if (empty) onClose(false)
  }, [empty, onClose])

  // Measure the current target, and keep measuring as the page scrolls/resizes under the overlay.
  useEffect(() => {
    if (!step) return
    const el = findAnchor(step.target)
    if (!el) return
    // scrollIntoView is absent under jsdom — optional-call it (same as SettingsPanel).
    el.scrollIntoView?.({ block: 'center', behavior: 'auto' })
    const measure = () => {
      const r = el.getBoundingClientRect()
      setRect({
        top: r.top - PAD,
        left: r.left - PAD,
        width: r.width + PAD * 2,
        height: r.height + PAD * 2,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { capture: true, passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, { capture: true } as EventListenerOptions)
    }
  }, [step])

  // Keyboard: Esc leaves the tour; focus rides the primary button so Enter pages through.
  const skip = useCallback(() => onClose(false), [onClose])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [skip])
  useEffect(() => {
    nextRef.current?.focus()
  }, [index])

  if (!step) return null

  const last = index === available.length - 1
  const next = () => (last ? onClose(true) : setIndex((i) => i + 1))

  // Card placement: mobile pins it above the bottom nav (always reachable, never overlaps the
  // spotlight math); desktop puts it under the cutout, flipping above when the fold is close.
  const cardStyle: React.CSSProperties = {}
  if (!isMobile && rect) {
    const below = rect.top + rect.height + CARD_GAP
    const fitsBelow = below + CARD_H_ESTIMATE <= window.innerHeight - 12
    cardStyle.top = fitsBelow ? below : Math.max(12, rect.top - CARD_GAP - CARD_H_ESTIMATE)
    cardStyle.left = Math.min(Math.max(rect.left, 12), window.innerWidth - CARD_W - 12)
    cardStyle.width = CARD_W
  }

  return createPortal(
    // z-[105]: above the mobile nav (z-40) and header overlays (z-50), below nothing it needs to
    // yield to — a confirm dialog (z-100) can't be open at the same time as the tour.
    <div className="fixed inset-0 z-[105]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* The spotlight: a cutout whose giant shadow is the dimmer. Transitions between steps so
          the hole glides from element to element. pointer-events-none — the overlay root itself
          (full-screen, transparent) is what swallows page clicks. */}
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-[14px] border-2 border-accent transition-all duration-200 ease-out"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: '0 0 0 200vmax rgba(46, 42, 36, 0.5)',
          }}
        />
      )}

      {/* The step card. */}
      <div
        className={
          'fixed rounded-xl border border-border-strong bg-panel p-4 shadow-xl ' +
          (isMobile ? 'inset-x-3 bottom-[104px]' : '')
        }
        style={cardStyle}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-light">
          {index + 1} of {available.length}
        </p>
        <h3 className="mt-1 font-serif text-base font-semibold text-ink">{step.title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-muted">{step.body}</p>
        {step.bullets && (
          <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-muted">
            {step.bullets.map((b) => (
              <li key={b.lead} className="flex gap-1.5">
                <span aria-hidden className="text-accent">
                  •
                </span>
                <span>
                  <span className="font-semibold text-ink">{b.lead}</span> — {b.rest}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={skip}
            className="rounded px-1.5 py-1 text-xs text-muted hover:text-ink"
          >
            Skip tour
          </button>
          {/* Progress dots — the filled one is the current step. */}
          <span aria-hidden className="mx-auto flex items-center gap-1">
            {available.map((s, i) => (
              <span
                key={s.target}
                className={
                  'h-1.5 w-1.5 rounded-full ' + (i === index ? 'bg-accent' : 'bg-border-strong')
                }
              />
            ))}
          </span>
          {index > 0 && (
            <button
              type="button"
              onClick={() => setIndex((i) => i - 1)}
              className="rounded-full border border-border-strong px-3.5 py-1.5 text-xs font-medium text-ink hover:border-ink"
            >
              Back
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={next}
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            {last ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
