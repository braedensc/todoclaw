var baseInner = null,
  baseVV = null
// ?h=lvh|svh|vh|app picks the initial shell mode; the buttons switch live.
function setMode(m) {
  var root = document.documentElement
  root.className = root.className.replace(/\bu-\w+\b/g, '').trim()
  if (m && m !== 'dvh') root.classList.add('u-' + m)
  document.getElementById('barlabel').textContent =
    '↑ nav sits here [' + (m || 'dvh') + '] — is it fully on-screen?'
}
;(function () {
  var m = /[?&]h=(lvh|svh|vh|app)\b/.exec(location.search)
  if (m) setMode(m[1])
})()
Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
  b.addEventListener('click', function () {
    setMode(b.getAttribute('data-mode'))
  })
})
// 'app' mode: the src/hooks/use-app-height.ts logic, verbatim semantics — measured
// visualViewport.height into --app-h; adopt growth + small (≤80px chrome) shrinks, ignore
// keyboard-sized shrinks, re-baseline on width change.
;(function () {
  var baseW = window.innerWidth,
    h = 0,
    applied = -1
  function apply() {
    var vp = window.visualViewport
    var visible = Math.round(vp ? vp.height : window.innerHeight)
    if (window.innerWidth !== baseW) {
      baseW = window.innerWidth
      h = 0
    }
    if (visible > h || h - visible <= 80) h = visible
    if (h !== applied) {
      applied = h
      document.documentElement.style.setProperty('--app-h', h + 'px')
    }
  }
  apply()
  if (window.visualViewport) window.visualViewport.addEventListener('resize', apply)
  window.addEventListener('resize', apply)
})()
function px(el) {
  return Math.round(el.getBoundingClientRect().height)
}
function ins(side) {
  // Read env(safe-area-inset-*) via a throwaway probe.
  var d = document.createElement('div')
  d.style.cssText = 'position:fixed;left:-9999px;height:env(safe-area-inset-' + side + ');'
  document.body.appendChild(d)
  var v = Math.round(d.getBoundingClientRect().height)
  d.remove()
  return v
}
function render() {
  var vv = window.visualViewport
  var standalone = matchMedia('(display-mode: standalone)').matches
  var navUA =
    /standalone/.test(navigator.standalone ? 'standalone' : '') ||
    window.navigator.standalone === true
  var innerH = window.innerHeight,
    innerW = window.innerWidth
  var vvH = vv ? Math.round(vv.height) : 0,
    vvW = vv ? Math.round(vv.width) : 0
  var vvTop = vv ? Math.round(vv.offsetTop) : 0
  var dvh = px(document.getElementById('dvh'))
  var lvh = px(document.getElementById('lvh'))
  var svh = px(document.getElementById('svh'))
  var vh = px(document.getElementById('vh'))
  var scrH = window.screen.height,
    scrW = window.screen.width
  var kbInnerDelta = baseInner != null ? baseInner - innerH : 0
  var kbVVDelta = baseVV != null ? baseVV - vvH : 0
  var L = []
  L.push(
    '<span class="hi">display-mode: ' + (standalone ? 'STANDALONE ✓' : 'browser (tab)') + '</span>',
  )
  L.push('nav.standalone   = ' + (window.navigator.standalone === true))
  L.push('')
  L.push('<span class="k">screen</span>        ' + scrW + ' x ' + scrH)
  L.push(
    '<span class="k">innerW/H</span>      ' + innerW + ' x <span class="hi">' + innerH + '</span>',
  )
  L.push(
    '<span class="k">visualVP W/H</span>  ' +
      vvW +
      ' x <span class="hi">' +
      vvH +
      '</span>   offsetTop=' +
      vvTop,
  )
  L.push('<span class="k">devicePixelR</span>  ' + window.devicePixelRatio)
  L.push('')
  L.push('<span class="k">100dvh</span>        <span class="hi">' + dvh + '</span>')
  L.push('<span class="k">100lvh</span>        <span class="hi">' + lvh + '</span>')
  L.push('<span class="k">100svh</span>        ' + svh)
  L.push('<span class="k">100vh</span>         ' + vh)
  L.push('')
  L.push(
    '<span class="k">safe-area T/R/B/L</span>  ' +
      ins('top') +
      ' / ' +
      ins('right') +
      ' / ' +
      ins('bottom') +
      ' / ' +
      ins('left'),
  )
  L.push('')
  L.push('<span class="k">— vs screen —</span>')
  L.push(
    'innerH - screen  = ' +
      (innerH - scrH) +
      (innerH !== scrH ? '  <span class="warn">(differs!)</span>' : ''),
  )
  L.push(
    'dvh - screen     = ' +
      (dvh - scrH) +
      (dvh !== scrH ? '  <span class="warn">(differs!)</span>' : ''),
  )
  L.push(
    'lvh - screen     = ' +
      (lvh - scrH) +
      (lvh !== scrH ? '  <span class="warn">(differs!)</span>' : ''),
  )
  L.push('')
  L.push('<span class="k">— keyboard deltas (vs baseline) —</span>')
  L.push(
    'baseline set:    ' +
      (baseInner != null
        ? 'yes (inner=' + baseInner + ', vv=' + baseVV + ')'
        : 'NO — tap the button first'),
  )
  L.push(
    'innerH shrink:   <span class="hi">' +
      kbInnerDelta +
      '</span>' +
      (kbInnerDelta > 40 ? '  <span class="warn">(inner shrinks w/ keyboard!)</span>' : ''),
  )
  L.push('visualVP shrink: <span class="hi">' + kbVVDelta + '</span>')
  L.push('')
  L.push('<span class="k">UA</span> ' + navigator.userAgent)
  document.getElementById('out').innerHTML = L.join('\n')
}
document.getElementById('cap').addEventListener('click', function () {
  baseInner = window.innerHeight
  baseVV = window.visualViewport ? Math.round(window.visualViewport.height) : baseInner
  render()
})
var vv = window.visualViewport
;['resize', 'scroll'].forEach(function (e) {
  vv && vv.addEventListener(e, render)
})
window.addEventListener('resize', render)
window.addEventListener('orientationchange', function () {
  setTimeout(render, 300)
})
// Auto-capture a baseline on first load (keyboard is down at load).
setTimeout(function () {
  baseInner = window.innerHeight
  baseVV = window.visualViewport ? Math.round(window.visualViewport.height) : baseInner
  render()
}, 400)
render()
