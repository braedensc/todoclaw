// Pre-paint theme boot (TOD-137). Loaded by index.html as a CLASSIC, blocking <script> in <head>
// (the CSP is `script-src 'self'`, so it cannot be inline) so <html> carries the right class before
// the first frame — no light flash for a dark-preferring device. It mirrors src/lib/theme.ts and
// src/hooks/use-theme.ts, which take over once the bundle loads; src/lib/theme-boot.test.ts pins
// the key, the default and the two theme-color literals (= src/index.css `--c-bg`) to those homes.
//
// The stored value is only ever COMPARED against the three literals — never written into the DOM.
// Any failure (storage blocked, no matchMedia) leaves the default.
;(function () {
  var KEY = 'todoclaw.theme'
  var DEFAULT = 'light'
  var COLORS = { light: '#f4efe6', dark: '#161411' }
  var pref = DEFAULT
  try {
    var raw = localStorage.getItem(KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') pref = raw
  } catch (_e) {
    pref = DEFAULT
  }
  var dark = false
  try {
    dark =
      pref === 'dark' ||
      (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  } catch (_e) {
    dark = DEFAULT === 'dark'
  }
  var theme = dark ? 'dark' : 'light'
  try {
    var root = document.documentElement
    root.classList.toggle('dark', dark)
    root.style.colorScheme = theme
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', COLORS[theme])
  } catch (_e) {
    // best-effort: the bundle's useTheme applies the same state once it loads
  }
})()
