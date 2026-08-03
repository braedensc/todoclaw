# ADR-0008 — Dev tooling: ESLint (flat) + Prettier + Vitest + React Testing Library

**Date:** 2026-06-23 · **Stage:** 2 (PR #2) · **Status:** Accepted

The lint/format tooling deferred from Stage 1 (ADR-0001) plus the unit/component test
harness, in one cohesive PR (so we don't lint code in one PR and re-touch it for tests in
the next). CI jobs + branch protection that *enforce* these are a separate PR (#4).

- **ESLint** — flat config (ESLint 10) in `eslint.config.js`: `@eslint/js` recommended +
  `typescript-eslint` recommended + `eslint-plugin-react-hooks` + `eslint-plugin-react-refresh`,
  with `eslint-config-prettier` **last** so Prettier owns all formatting. Chose the
  **non-type-aware** `recommended` (not `recommendedTypeChecked`) for speed and to avoid the
  "file not in project" friction the project-reference layout creates; type-checked rules are a
  deliberate later toggle, not a Stage 2 dependency. `no-unused-vars` is configured to honor the
  `_`-prefix convention (matching `tsconfig`'s `noUnusedParameters`).
- **Prettier** — `.prettierrc` (`semi: false`, `singleQuote`, `trailingComma: all`,
  `printWidth: 100`) matches the hand-written Stage 1 style, so adoption churned only a few
  lines. **Markdown is in `.prettierignore`** — docs/ADRs/READMEs are hand-formatted (tables,
  wrapping) and Prettier's markdown reflow would be pure noise.
- **Vitest + RTL** — `vitest.config.ts` (jsdom; `globals: false`, so test APIs are imported
  explicitly from `vitest` and strict TS needs **no** ambient `vitest/globals` types).
  `src/test/setup.ts` registers jest-dom via `@testing-library/jest-dom/vitest` (which also
  augments `expect`'s types) and runs RTL `cleanup()` after each test.
- **Two traps handled** (per the planning critique):
  - *`tsc -b` sees test files* (they live under `src/`). Explicit `vitest` imports + the
    jest-dom/vitest augmentation mean no `tsconfig` `types` surgery; `vitest.config.ts` is added
    to `tsconfig.node.json`'s `include` so it's typechecked node-side.
  - *`src/lib/supabase.ts` throws on missing env at import.* Component tests `vi.mock` the data
    hooks (`./use-tasks`) so no client/env is needed. A future env-based test must use a
    **non-JWT** dummy anon key — the Claude Code `PreToolUse` hook blocks writing `eyJ…` values
    into files.
- **Pre-commit** — `lint-staged` appended to `.husky/pre-commit` *after* the secretlint block,
  preserving the Node-PATH shim: `eslint --fix` + `prettier --write` on staged `ts/tsx`. Still
  layer 2 (bypassable); CI (PR #4) is the real gate.
- **Seed tests** — `localDateInTZ` (timezone + DST + invalid-zone), Zod round-trips for all four
  schemas (incl. the `bucket` literal and the blank-`timezone` rejection), and a `TaskList`
  render smoke test. `npm run lint`/`typecheck`/`test`/`format:check` all green locally.
