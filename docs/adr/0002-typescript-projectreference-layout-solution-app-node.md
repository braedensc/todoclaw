# ADR-0002 — TypeScript project-reference layout (solution + app + node)

**Date:** 2026-06-23 · **Stage:** 1 (PR #1)

`tsconfig.json` is a solution file (`files: []`, references) pointing at `tsconfig.app.json`
(browser/`src`, `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals/Parameters`) and
`tsconfig.node.json` (`vite.config.ts`, `types: ["node"]`). `npm run build` runs
`tsc -b && vite build`; `npm run typecheck` runs `tsc -b`.

- The two environments have genuinely different globals (DOM vs. Node). Splitting them is the
  canonical Vite layout and keeps the app config free of Node types.
- `@types/node` is required by `tsconfig.node.json` because Vite's own `.d.ts` references
  `Buffer`/`Request`/`WebSocket`. Without it, `tsc -b` fails — installed as a devDependency.
