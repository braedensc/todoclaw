import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

// Flat config (ESLint 10). We use the non-type-aware `recommended` set for speed and
// reliability across the TS project-reference layout; type-checked rules are a deliberate
// later toggle, not a Stage 2 dependency. `eslint-config-prettier` is LAST so it switches
// off any stylistic rules that would fight Prettier (Prettier owns formatting).
export default tseslint.config(
  // supabase/functions is Deno (different runtime + globals + npm:/URL imports); it is
  // checked with Deno's own toolchain (deno check / deno test), not the frontend ESLint.
  // Prettier still formats it (one repo formatter).
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'supabase/functions'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Allow non-component constant exports (e.g. query keys) without a fast-refresh warning.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Align unused-vars with the TS `_`-prefix convention (matches noUnusedParameters).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Node-context files (build/test config).
  {
    files: ['**/*.config.{js,ts}', 'vitest.config.ts'],
    languageOptions: { globals: globals.node },
  },
  // Test + setup files run under jsdom with Node available.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  // Playwright E2E (smoke + golden harness): the test-runner runs in Node, while page.evaluate
  // bodies run in the browser — so allow both global sets. No React here: Playwright fixtures
  // take a `use` callback that the rules-of-hooks rule misreads as a React hook, so it's off.
  {
    files: ['e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  // Standalone dev scripts (Node CLIs, no React) — see scripts/demo-seed/README.md.
  {
    files: ['scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
  prettier,
)
