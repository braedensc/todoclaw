/** @type {import('tailwindcss').Config} */

// Design tokens, documented in docs/STYLE.md. Color VALUES live in src/index.css as `--c-*`
// RGB triplets (light on :root, dark on html.dark); src/lib/theme-tokens.test.ts pins that every
// token below has both.
// Fonts are self-hosted via @fontsource (imported in src/main.tsx) — no external
// Google Fonts request, which keeps the warm-paper look without leaking the page
// load to a third party (privacy).
/** A palette token backed by the `--c-<name>` CSS variable, alpha-modifier aware. */
const c = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // The app's single mobile/desktop LAYOUT GATE, mirroring MOBILE_MEDIA_QUERY in
      // src/hooks/use-is-mobile.ts: `wide:` utilities apply exactly where `useIsMobile()` is
      // false, so CSS layout and JS gating flip at the same boundary. Since ADR
      // 2026-07-23-phones-stay-mobile-in-landscape that boundary is COMPOUND (width plus a
      // landscape-phone leg), not a bare 720px — see the `wide` comment below. Added alongside
      // Tailwind's defaults (sm/md/lg/xl), not replacing them.
      screens: {
        // `wide` = the DESKTOP side of the layout gate — the complement of MOBILE_MEDIA_QUERY
        // in src/hooks/use-is-mobile.ts (keep the two in lockstep; ADR-0020's "flip at the
        // identical boundary" rule now covers the landscape leg too). Phones stay MOBILE in
        // both orientations (ADR 2026-07-23-phones-stay-mobile-in-landscape), so wide is no
        // longer plain min-width: it also requires NOT (coarse ∧ phone-shaped ∧ ≤1023px wide).
        // Aspect+width, never height — the iOS keyboard shrinks the layout viewport in
        // installed PWAs, so a height leg would flip the shell mid-typing on an iPad (see
        // LANDSCAPE_PHONE_MAX_WIDTH's derivation). Spelled as a four-query list instead of
        // Media Queries 4 `not (...)` so older engines that can't parse boolean negation don't
        // silently drop the desktop styles:
        //   ¬(coarse ∧ ar≥8/5 ∧ w≤1023) ≡ fine ∨ none ∨ ar<8/5 ∨ w≥1024
        // The ar<8/5 leg is max-aspect-ratio: 1599/1000 — a hairline GAP at aspect (1.599, 1.6)
        // beats an overlap where both shells' styles would apply at exactly 8/5.
        wide: {
          raw: '(min-width: 720px) and (pointer: fine), (min-width: 720px) and (pointer: none), (min-width: 1024px), (min-width: 720px) and (max-aspect-ratio: 1599/1000)',
        },
      },
      // Every color is a CSS variable (an RGB triplet) defined in src/index.css — today's warm-paper
      // values on :root, the warm-charcoal dark set on html.dark — consumed as
      // `rgb(var(--c-x) / <alpha-value>)` so opacity modifiers (`bg-panel/80`) keep compiling.
      // Per-token rationale (the 2026-07-08 muted darkening, danger's AA tuning, puppy's sparing
      // use) lives beside the values in index.css; the token table is docs/STYLE.md.
      colors: {
        // Surfaces (warm paper)
        bg: c('bg'),
        panel: c('panel'),
        card: c('card'),
        // Text
        ink: c('ink'),
        muted: {
          DEFAULT: c('muted'),
          light: c('muted-light'),
          faint: c('muted-faint'),
        },
        // Text on solid fills: `on-ink` on `bg-ink`, `on-accent` on primary/accent/danger/puppy.
        'on-ink': c('on-ink'),
        'on-accent': c('on-accent'),
        'on-ink-accent': c('on-ink-accent'), // terracotta that reads on a solid `ink` fill
        // Modal overlays — dark in BOTH modes (an ink scrim would turn light in dark mode).
        scrim: c('scrim'),
        // Warm paper in BOTH modes — the plate under fixed light artwork (the install mockups).
        'paper-fixed': c('paper-fixed'),
        // Borders
        border: {
          DEFAULT: c('border'),
          strong: c('border-strong'),
        },
        // Brand accents
        primary: c('primary'), // green — Add / Set buttons
        accent: c('accent'), // terracotta — one-time bucket dot, urgency
        // Deeper text shades of primary/accent for small type on their own /10 washes (chat receipts).
        'primary-deep': c('primary-deep'),
        'accent-deep': c('accent-deep'),
        danger: c('danger'), // warm brick red — destructive/delete affordances
        puppy: c('puppy'), // BabyClaw slate-blue — BabyClaw mode + the habits surface
        // Eisenhower quadrants
        quadrant: {
          'do-now': c('quadrant-do-now'),
          schedule: c('quadrant-schedule'),
          errands: c('quadrant-errands'),
          someday: c('quadrant-someday'),
        },
      },
      // Grid elevation (TOD-140): composite shadows defined per mode in src/index.css, so they
      // deepen and gain a light rim on dark.
      boxShadow: {
        canvas: 'var(--shadow-canvas)',
        popover: 'var(--shadow-popover)',
        lift: 'var(--shadow-lift)',
      },
      fontFamily: {
        serif: ['"Fraunces Variable"', 'Fraunces', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
