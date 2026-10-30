// Theme preference — pure logic (TOD-137). The preference is DEVICE-LOCAL (localStorage), never
// account config: it is a fact about this screen, and it must be readable synchronously before
// first paint, which a network-loaded user_schedule row cannot be. It is never sent to the server
// or the AI.
//
// Three lockstep homes (pinned by src/lib/theme-boot.test.ts):
//  - this file (the key, the literals, the default);
//  - public/theme-boot.js, the classic pre-paint script that applies the stored choice before the
//    bundle loads (the CSP is `script-src 'self'`, so it cannot be inline);
//  - index.html's `<meta name="theme-color">` and `<script src="/theme-boot.js">` tags.
// The theme-color values themselves are src/index.css's `--c-bg` (:root and html.dark).

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'todoclaw.theme'

/** What an absent or unreadable stored value means: follow the OS (TOD-142, with the Settings control). */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

/** Exactly the three literals are accepted; anything else (null, garbage, 'dark foo') is the default. */
export function parseThemePreference(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : DEFAULT_THEME_PREFERENCE
}

/** The theme actually rendered: 'system' follows the OS `prefers-color-scheme`. */
export function resolveTheme(pref: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return prefersDark ? 'dark' : 'light'
  return pref
}
