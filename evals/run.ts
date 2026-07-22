// run.ts — CLI entry. See evals/README.md for the full guide.
//
//   deno task eval -- --list
//   deno task eval -- --kind plan --no-judge
//   deno task eval -- --filter pause --save-baseline
//   deno task eval -- --baseline results/baseline.json
//
// (via npm: `npm run eval -- --filter pause`)

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { ALL_SCENARIOS } from './scenarios/index.ts'
import { evalClient, PROD_MODEL } from './lib/judge.ts'
import { mockAnthropic } from './lib/mock.ts'
import { runScenarios } from './lib/runner.ts'
import { compareToBaseline, printSummary, saveReport } from './lib/report.ts'
import type { RunReport, Scenario } from './lib/types.ts'

function flag(name: string): boolean {
  return Deno.args.includes(`--${name}`)
}
function opt(name: string): string | undefined {
  const i = Deno.args.indexOf(`--${name}`)
  return i >= 0 && i + 1 < Deno.args.length && !Deno.args[i + 1].startsWith('--')
    ? Deno.args[i + 1]
    : undefined
}

async function gitRef(): Promise<string> {
  try {
    const out = await new Deno.Command('git', {
      args: ['rev-parse', '--short', 'HEAD'],
      stdout: 'piped',
      stderr: 'null',
    }).output()
    return new TextDecoder().decode(out.stdout).trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function filterScenarios(all: Scenario[]): Scenario[] {
  const kind = opt('kind')
  const needle = opt('filter')?.toLowerCase()
  return all.filter((sc) => {
    if (kind && sc.kind !== kind) return false
    if (
      needle &&
      !sc.id.toLowerCase().includes(needle) &&
      !sc.tags.some((t) => t.toLowerCase().includes(needle))
    ) {
      return false
    }
    return true
  })
}

// duplicate-id guard — scenario files are authored independently
{
  const seen = new Set<string>()
  for (const sc of ALL_SCENARIOS) {
    if (seen.has(sc.id)) throw new Error(`duplicate scenario id: ${sc.id}`)
    seen.add(sc.id)
  }
}

const selected = filterScenarios(ALL_SCENARIOS)

if (flag('list')) {
  for (const kind of ['chat', 'plan', 'recap'] as const) {
    const group = selected.filter((sc) => sc.kind === kind)
    if (!group.length) continue
    console.log(`\n${kind} (${group.length}):`)
    for (const sc of group) {
      console.log(
        `  ${sc.id}  [${sc.tags.join(',')}]${sc.expectFailUntil ? `  ⏳ until ${sc.expectFailUntil}` : ''}`,
      )
    }
  }
  console.log(`\n${selected.length} scenario(s) selected of ${ALL_SCENARIOS.length} total`)
  Deno.exit(0)
}

if (!selected.length) {
  console.error('no scenarios match the filter')
  Deno.exit(2)
}

const mock = flag('mock')
const noJudge = flag('no-judge') || mock
const judgeModel = opt('judge-model') ?? PROD_MODEL
const repeat = Number(opt('repeat') ?? '1')
const concurrency = Number(opt('concurrency') ?? '3')

const anthropic = (mock ? mockAnthropic() : evalClient()) as unknown as Anthropic
const judgeClient = noJudge ? null : (anthropic as Anthropic)

console.log(
  `running ${selected.length} scenario(s)` +
    (repeat > 1 ? ` ×${repeat}` : '') +
    (mock
      ? ' [MOCK — no API calls]'
      : ` [model ${PROD_MODEL}, judge ${noJudge ? 'off' : judgeModel}]`),
)

const results = await runScenarios(selected, {
  anthropic,
  judgeClient,
  judgeModel,
  mock,
  repeat,
  concurrency,
})

const report: RunReport = {
  startedAt: new Date().toISOString(),
  gitRef: await gitRef(),
  model: mock ? 'mock' : PROD_MODEL,
  judgeModel: noJudge ? null : judgeModel,
  results,
}

const { failed } = printSummary(report)

const savedTo = await saveReport(
  report,
  flag('save-baseline') ? 'results/baseline.json' : undefined,
)
console.log(`report: evals/${savedTo}`)

const baseline = opt('baseline')
if (baseline) await compareToBaseline(baseline, report)

Deno.exit(failed > 0 && !flag('no-fail-exit') ? 1 : 0)
