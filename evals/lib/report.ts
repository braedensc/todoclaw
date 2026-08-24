// report.ts — console summary, JSON persistence, and baseline comparison.
//
// The compare workflow is git-native: run on a baseline branch with --save-baseline, edit prompts,
// re-run with --baseline <path> — the report prints per-scenario deltas so a prompt experiment
// reads as a diff, not a vibe.

import type { RunReport, ScenarioResult } from './types.ts'

export function detPass(res: ScenarioResult): boolean {
  return res.deterministic.every((c) => c.pass) && !res.error
}

export function overallPass(res: ScenarioResult): boolean {
  return detPass(res) && (res.judge ? res.judge.verdict === 'pass' : true)
}

function fmtScores(scores: Record<string, number>): string {
  return Object.entries(scores)
    .map(([k, v]) => `${k[0]}${v}`)
    .join(' ')
}

export function printSummary(report: RunReport): { failed: number; expectedFail: number } {
  const lines: string[] = []
  let failed = 0
  let expectedFail = 0

  for (const kind of ['chat', 'plan', 'recap'] as const) {
    const group = report.results.filter((res) => res.kind === kind)
    if (!group.length) continue
    lines.push('', `── ${kind} (${group.length}) ${'─'.repeat(Math.max(0, 50 - kind.length))}`)
    for (const res of group) {
      const pass = overallPass(res)
      const expected = Boolean(res.expectFailUntil)
      let mark: string
      if (pass) mark = expected ? '✓?' : ' ✓'
      else if (expected) {
        mark = '⏳'
        expectedFail++
      } else {
        mark = ' ✗'
        failed++
      }
      const judgeBit = res.judge ? `judge:${res.judge.verdict} ${fmtScores(res.judge.scores)}` : ''
      lines.push(
        `${mark} ${res.id}  [${res.tags.join(',')}] ${judgeBit}` +
          (res.expectFailUntil ? `  (expected-fail until ${res.expectFailUntil})` : ''),
      )
      if (!pass) {
        for (const c of res.deterministic.filter((c) => !c.pass)) {
          lines.push(`     ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
        }
        if (res.judge?.verdict === 'fail') lines.push(`     ✗ judge — ${res.judge.reasoning}`)
        if (res.error) lines.push(`     ✗ error — ${res.error}`)
      }
    }
  }

  const total = report.results.length
  const passed = report.results.filter((res) => overallPass(res)).length
  const inTok = report.results.reduce((n, res) => n + res.usage.input, 0)
  const outTok = report.results.reduce((n, res) => n + res.usage.output, 0)
  // Prompt-cache tokens (optional on pre-PR-3 reports): input is the UNCACHED remainder once
  // cache_control is in play — writes bill at 1.25× and reads at 0.1× of the input rate.
  const cwTok = report.results.reduce((n, res) => n + (res.usage.cacheWrite ?? 0), 0)
  const crTok = report.results.reduce((n, res) => n + (res.usage.cacheRead ?? 0), 0)
  // prod-model pricing (input $3/M, output $15/M) — an estimate for the console, not billing truth
  const estUsd = (inTok * 3 + outTok * 15 + cwTok * 3 * 1.25 + crTok * 3 * 0.1) / 1_000_000
  const cacheBit =
    cwTok || crTok
      ? ` · cache ${cwTok.toLocaleString()} written / ${crTok.toLocaleString()} read`
      : ''
  lines.push(
    '',
    `${passed}/${total} passed · ${failed} failed · ${expectedFail} expected-fail (pending PRs)`,
    `tokens: ${inTok.toLocaleString()} in / ${outTok.toLocaleString()} out${cacheBit} (≈$${estUsd.toFixed(2)})`,
  )
  console.log(lines.join('\n'))
  return { failed, expectedFail }
}

export async function saveReport(report: RunReport, path?: string): Promise<string> {
  const target = path ?? `results/run-${report.startedAt.replace(/[:.]/g, '-')}.json`
  await Deno.mkdir('results', { recursive: true }).catch(() => {})
  await Deno.writeTextFile(target, JSON.stringify(report, null, 2))
  return target
}

/** Pure core of the baseline diff: report-in, lines-out, no I/O — so the cancellation regression
 * below can be unit-tested without granting the test task write access. */
export function diffLines(
  baseline: RunReport,
  current: RunReport,
  baselinePath: string,
): { lines: string[]; regressions: number; qualityDrops: number } {
  const byId = new Map(baseline.results.map((res) => [res.id, res]))
  const lines: string[] = ['', `── vs baseline ${baselinePath} (${baseline.gitRef}) ──`]
  let regressions = 0
  let qualityDrops = 0
  for (const res of current.results) {
    const base = byId.get(res.id)
    if (!base) {
      lines.push(`  + ${res.id} (new)`)
      continue
    }
    const was = overallPass(base)
    const now = overallPass(res)
    if (was !== now) {
      lines.push(`  ${now ? '↑ FIXED' : '↓ REGRESSED'} ${res.id}`)
      if (!now) regressions++
    } else if (res.judge && base.judge) {
      // PER-AXIS, never summed. A summed delta cancels: correctness 5→1 with tone 1→5 is Σ0, so
      // the old code printed NOTHING for a model that started picking the wrong task but writing
      // more warmly — on the very report the model-switch gate is decided from. Correctness and
      // faithfulness are the "did it do the right thing" axes; a drop in either is flagged on its
      // own merits however the other axes moved.
      const deltas = (['correctness', 'faithfulness', 'tone', 'brevity'] as const)
        .map(
          (k) =>
            [k, res.judge!.scores[k] - (base.judge!.scores[k] ?? res.judge!.scores[k])] as const,
        )
        .filter(([, d]) => d !== 0)
      if (deltas.length) {
        const material = deltas.filter(
          ([k, d]) => d < 0 && (k === 'correctness' || k === 'faithfulness'),
        )
        const rendered = deltas.map(([k, d]) => `${k} ${d > 0 ? '+' : ''}${d}`).join(', ')
        const net = deltas.reduce((a, [, d]) => a + d, 0)
        const mark = material.length ? '⚠ QUALITY' : net > 0 ? '↑' : '↓'
        lines.push(`  ${mark} ${res.id} judge: ${rendered}`)
        if (material.length) qualityDrops++
      }
    }
  }
  for (const base of baseline.results) {
    if (!current.results.some((res) => res.id === base.id)) lines.push(`  - ${base.id} (dropped)`)
  }
  if (lines.length === 2) lines.push('  (no changes)')
  lines.push(regressions ? `  ${regressions} regression(s)` : '  no regressions')
  // Surfaced separately from verdict regressions: these still PASSED, but got worse at the thing
  // that matters. On a model-switch run this is the line to read before flipping anything.
  if (qualityDrops)
    lines.push(`  ${qualityDrops} correctness/faithfulness score drop(s) — review before switching`)
  return { lines, regressions, qualityDrops }
}

export async function compareToBaseline(baselinePath: string, current: RunReport): Promise<void> {
  let baseline: RunReport
  try {
    baseline = JSON.parse(await Deno.readTextFile(baselinePath)) as RunReport
  } catch (e) {
    console.error(`could not read baseline ${baselinePath}: ${e}`)
    return
  }
  console.log(diffLines(baseline, current, baselinePath).lines.join('\n'))
}
