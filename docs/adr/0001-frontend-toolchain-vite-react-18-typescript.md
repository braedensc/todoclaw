# ADR-0001 — Frontend toolchain: Vite + React 18 + TypeScript (strict) + Tailwind 3

**Date:** 2026-06-23 · **Stage:** 1 (PR #1)

The walking-skeleton toolchain. Resolved versions: Vite 8, `@vitejs/plugin-react` 6,
React 18.3, TypeScript 6, Tailwind 3.4, TanStack Query 5, `@supabase/supabase-js` 2, Zod 4.

- **React pinned to 18, not 19.** The master plan specifies React 18; staying on it avoids
  churn from React 19's breaking changes until the feature set is stable. Revisit post-parity.
- **Tailwind pinned to v3, not v4.** v4's CSS-first config (`@import "tailwindcss"`,
  `@tailwindcss/postcss`) is a different setup from the v3 `tailwind.config.js` +
  `@tailwind` directives + `autoprefixer` model the plan describes. v3 is the well-trodden,
  lower-friction path for now; a v4 migration is a deliberate later task, not an accident of
  `npm install` resolving `latest`.
- **Hand-written config over `npm create vite`.** The scaffolder would clobber the Stage 0
  `package.json` (husky/secretlint) and pull in an ESLint config we're deferring to Stage 2.
  Writing the handful of config files keeps full control and matches the "explicit over
  clever" convention.
- **Rejected:** Next.js (we want a pure SPA on Vite + Supabase, no SSR/server framework);
  CRA (unmaintained).
