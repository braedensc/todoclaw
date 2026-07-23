import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The mobile/desktop LAYOUT GATE lives in four places that must flip at the identical boundary
// (ADR 2026-07-23-phones-stay-mobile-in-landscape): the useIsMobile hook (whose exported string
// use-is-mobile.test.ts pins), the index.css locked-shell block, tailwind's `wide` screen (the
// complement), and the vp-probe on-device badge. This Node-side test reads all four from disk so
// editing any single home fails HERE instead of silently splitting the JS layout from the CSS —
// the review-caught gap: reverting index.css alone would render the mobile DOM without the
// locked viewport, reproducing the exact floating-bar bug class, with every jsdom test green.

const root = process.cwd()
const read = (p) => readFileSync(resolve(root, p), 'utf8')

const MOBILE =
  '(max-width: 719px), ((pointer: coarse) and (min-aspect-ratio: 8/5) and (max-width: 1023px))'
const WIDE =
  '(min-width: 720px) and (pointer: fine), (min-width: 720px) and (pointer: none), (min-width: 1024px), (min-width: 720px) and (max-aspect-ratio: 1599/1000)'

describe('layout-gate lockstep', () => {
  it('the hook builds exactly the canonical mobile query', () => {
    // The hook's string is template-built; rather than importing TS here, pin the pieces that
    // compose it (use-is-mobile.test.ts pins the assembled string in the jsdom lane).
    const hook = read('src/hooks/use-is-mobile.ts')
    expect(hook).toContain('export const MOBILE_MAX_WIDTH = 719')
    expect(hook).toContain('export const LANDSCAPE_PHONE_MAX_WIDTH = 1023')
    expect(hook).toContain(
      '`(max-width: ${MOBILE_MAX_WIDTH}px), ((pointer: coarse) and (min-aspect-ratio: 8/5) and (max-width: ${LANDSCAPE_PHONE_MAX_WIDTH}px))`',
    )
  })

  it('index.css locks the shell behind exactly the canonical mobile query', () => {
    expect(read('src/index.css')).toContain(`@media ${MOBILE} {`)
  })

  it("tailwind's wide screen is exactly the canonical complement", () => {
    expect(read('tailwind.config.js')).toContain(`raw: '${WIDE}'`)
  })

  it('index.css uses the same complement for the desktop-side safe-area pad', () => {
    // Spelled multi-line by Prettier — compare whitespace-normalized.
    const css = read('src/index.css').replace(/\s+/g, ' ')
    expect(css).toContain(`@media ${WIDE} {`)
  })

  it('the vp-probe badge evaluates the same pair on-device', () => {
    const probe = read('public/vp-probe.js')
    expect(probe).toContain(MOBILE)
    expect(probe).toContain(WIDE)
  })
})
