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
      colors: {
        // Surfaces (warm paper)
        bg: '#f4efe6',
        panel: '#fbf8f1',
        card: '#fff',
        // Text
        ink: '#2e2a24',
        muted: {
          DEFAULT: '#7a7466',
          light: '#9a9080',
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
