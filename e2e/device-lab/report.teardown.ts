import fs from 'node:fs'
import path from 'node:path'
import { REPORT_DIR } from './report-paths'

// Assembles the device-lab contact sheet after every run: one row per device (narrow → wide),
// one column per screenshot scenario, red-flagged where the anchoring assertions failed. Pure
// static HTML with relative image paths, so the whole device-lab-report/ folder is portable.

interface LabRecord {
  device: string
  viewport: { width: number; height: number }
  scenario: string
  status: string
  notes: string[]
  shots: { label: string; file: string; viewport: { width: number; height: number } }[]
}

// Column order mirrors the user journey: resting layout → viewport-height change → keyboard up.
const SHOT_ORDER = [
  'baseline',
  'browser chrome',
  'standalone',
  'add sheet + keyboard',
  'chat + keyboard',
]

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(REPORT_DIR)) return
  const records: LabRecord[] = fs
    .readdirSync(REPORT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8')) as LabRecord)
  if (records.length === 0) return

  const byDevice = new Map<string, LabRecord[]>()
  for (const r of records) {
    byDevice.set(r.device, [...(byDevice.get(r.device) ?? []), r])
  }
  const deviceOrder = [...byDevice.keys()].sort(
    (a, b) =>
      (byDevice.get(a)![0]!.viewport.width || 0) - (byDevice.get(b)![0]!.viewport.width || 0),
  )

  const failures = records.filter((r) => r.status !== 'passed')

  const rows = deviceOrder
    .map((device) => {
      const recs = byDevice.get(device)!
      const shots = recs
        .flatMap((r) => r.shots.map((s) => ({ ...s, status: r.status, notes: r.notes })))
        .sort((a, b) => SHOT_ORDER.indexOf(a.label) - SHOT_ORDER.indexOf(b.label))
      const vp = recs[0]!.viewport
      const bad = recs.some((r) => r.status !== 'passed')
      const cells = shots
        .map(
          (s) => `
        <figure class="cell ${s.status === 'passed' ? 'ok' : 'bad'}">
          <a href="${esc(s.file)}" target="_blank"><img loading="lazy" src="${esc(s.file)}" alt="${esc(device)} — ${esc(s.label)}" style="aspect-ratio:${s.viewport.width}/${s.viewport.height}"></a>
          <figcaption>${esc(s.label)} · ${s.viewport.width}×${s.viewport.height}</figcaption>
        </figure>`,
        )
        .join('')
      const notes = recs
        .flatMap((r) => r.notes.map((n) => `[${esc(r.scenario)}] ${esc(n)}`))
        .map((n) => `<li>${n}</li>`)
        .join('')
      return `
      <section class="device ${bad ? 'bad' : ''}">
        <h2>${esc(device)} <span class="dim">${vp.width}×${vp.height}</span> ${bad ? '<span class="flag">FAILED</span>' : '<span class="pass">all anchored ✓</span>'}</h2>
        <div class="strip">${cells}</div>
        <details><summary>measurements</summary><ul>${notes}</ul></details>
      </section>`
    })
    .join('\n')

  const html = `<!doctype html>
<meta charset="utf-8">
<title>TodoClaw device lab — bottom-bar anchoring</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 24px; background: #17161a; color: #eae6df; font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #9a948a; margin: 0 0 20px; }
  .device { margin: 26px 0; padding: 14px 16px; border: 1px solid #2e2c33; border-radius: 12px; background: #1d1c21; }
  .device.bad { border-color: #a04434; }
  h2 { font-size: 15px; margin: 0 0 10px; }
  .dim { color: #9a948a; font-weight: 400; margin-left: 6px; }
  .flag { color: #ff7a5c; margin-left: 8px; }
  .pass { color: #7fb98a; margin-left: 8px; font-weight: 400; }
  .strip { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 6px; }
  .cell { margin: 0; flex: 0 0 auto; }
  .cell img { height: 380px; width: auto; display: block; border-radius: 10px; border: 2px solid #3a3741; background: #000; }
  .cell.bad img { border-color: #d0553d; }
  figcaption { color: #9a948a; font-size: 11px; margin-top: 5px; text-align: center; }
  details { margin-top: 8px; color: #9a948a; font-size: 12px; }
  ul { margin: 6px 0 0; padding-left: 18px; }
  .failbox { border: 1px solid #a04434; border-radius: 10px; padding: 10px 14px; margin: 14px 0; background: #241a18; }
</style>
<h1>TodoClaw device lab — bottom-bar anchoring</h1>
<p class="sub">${records.length} checks across ${deviceOrder.length} devices — every screenshot asserts the bottom nav flush to the viewport bottom (page unscrolled). Keyboard shots drive the app's real visualViewport path via a shim.</p>
${
  failures.length > 0
    ? `<div class="failbox"><strong>${failures.length} failing:</strong> ${failures.map((f) => `${esc(f.device)} / ${esc(f.scenario)}`).join(' · ')}</div>`
    : ''
}
${rows}`

  fs.writeFileSync(path.join(REPORT_DIR, 'index.html'), html)
  const rel = path.relative(process.cwd(), path.join(REPORT_DIR, 'index.html'))
  console.log(
    `\nDevice lab: ${records.length - failures.length}/${records.length} checks anchored across ${deviceOrder.length} devices → open ${rel}`,
  )
}
