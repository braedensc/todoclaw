/** @type {import('tailwindcss').Config} */

// EisenClaw design tokens. Exact hex values come from
// planning/EISENCLAW-LOGIC-TO-PORT.md § 13 and are documented in docs/STYLE.md.
// Fonts are self-hosted via @fontsource (imported in src/main.tsx) — no external
// Google Fonts request, which keeps the warm-paper look without leaking the page
// load to a third party (privacy).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // The app's single mobile/desktop breakpoint, mirroring `MOBILE_MAX_WIDTH` (719) in
      // src/hooks/use-is-mobile.ts: `wide:` utilities apply at >= 720px (desktop), so CSS layout
      // and the JS `useIsMobile()` (which drives tap-to-place) flip at the exact same width.
      // Added alongside Tailwind's defaults (sm/md/lg/xl), not replacing them.
      screens: {
        wide: '720px',
      },
      colors: {
        // Surfaces (warm paper)
        bg: '#f4efe6',
        panel: '#fbf8f1',
        card: '#fff',
        // Text
        ink: '#2e2a24',
        // Darkened 2026-07-08 (mobile audit §6.1) from #7a7466 / #9a9080: the old pair measured
        // 4.4:1 / 2.9:1 against `panel`, under WCAG AA for the small sizes they're used at. These
        // hold the same warm hue at 5.1:1 / 4.2:1 while keeping the two tiers visually distinct
        // (a full 4.5:1 light tier would collapse into `muted`). Applies app-wide by design.
        muted: {
          DEFAULT: '#706a5d',
          light: '#807768',
          faint: '#bcb09a',
        },
        // Borders
        border: {
          DEFAULT: '#e4dcc9',
          strong: '#ddd4c0',
        },
        // Brand accents
        primary: '#5b8a72', // green — Add / Set buttons
        accent: '#c2693f', // terracotta — one-time bucket dot, urgency
        // Warm brick red for destructive/delete affordances (IconButton `danger`, ConfirmDialog).
        // Distinct from terracotta `accent` (which is orange-leaning) but tuned to the warm-paper
        // palette; passes AA for white text on the fill and for the glyph on paper/card. See
        // src/components/IconButton.tsx.
        danger: '#b3392f',
        // Soft slate-blue pulled from BabyClaw's real-life namesake's eyes. Sparing use only —
        // BabyClaw-mode accents (active toggle, focus ring), never functional/urgency colors.
        puppy: '#5f8aa3',
        // Eisenhower quadrants
        quadrant: {
          'do-now': '#bf5e2a',
          schedule: '#3d7a5f',
          errands: '#7d6b1e',
          someday: '#857c6e',
        },
      },
      fontFamily: {
        serif: ['"Fraunces Variable"', 'Fraunces', 'Georgia', 'serif'],
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
