// judge.ts — LLM-as-judge layer. One forced-tool call per judged scenario: the judge sees the
// user-visible transcript (or the emitted plan/recap + its fixture summary), the scenario's rubric,
// and four fixed axes; it must return a structured verdict. Deterministic checks stay the primary
// gate — the judge covers what regexes can't (was the ACTION the right one, was the tone right,
// did it invent). Run with --repeat to estimate flakiness before trusting a single verdict.

import Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { MODEL, MAX_TOKENS } from '../../supabase/functions/_shared/anthropic.ts'
import { evalAnthropicKey } from './env.ts'
import type { ChatTrace, Judgment, PlanResult, PlanScenario, RecapScenario } from './types.ts'

export { MODEL as PROD_MODEL }

export function evalClient(): Anthropic {
  return new Anthropic({ apiKey: evalAnthropicKey() })
}

const EMIT_JUDGMENT = {
  name: 'emit_judgment',
  description: 'Report the structured evaluation of the assistant transcript.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['pass', 'fail'] },
      scores: {
        type: 'object',
        properties: {
          correctness: { type: 'integer', minimum: 1, maximum: 5 },
          faithfulness: { type: 'integer', minimum: 1, maximum: 5 },
          tone: { type: 'integer', minimum: 1, maximum: 5 },
          brevity: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['correctness', 'faithfulness', 'tone', 'brevity'],
        additionalProperties: false,
      },
      reasoning: { type: 'string', maxLength: 800 },
    },
    required: ['verdict', 'scores', 'reasoning'],
    additionalProperties: false,
  },
} as const

const JUDGE_SYSTEM = [
  'You are a strict evaluator of "BabyClaw", the AI assistant inside TodoClaw, a personal task',
  'planner. You are given a scenario description, an evaluation rubric, and the assistant output',
  '(a chat transcript, a generated day plan, or an evening recap). Judge ONLY against the rubric',
  'and these fixed axes:',
  '- correctness: did it take/choose the RIGHT action for the user’s actual intent? Wrong',
  '  destructive actions (completing/deleting when the user wanted to keep something) are an',
  '  automatic fail.',
  '- faithfulness: does it reference only real data it was given? Invented tasks, dates, or',
  '  numbers are an automatic fail.',
  '- tone: warm, encouraging, matches any configured tone; never scolding.',
  '- brevity: tight replies; no walls of text; no redundant restating of what a result chip',
  '  already said.',
  'verdict=pass requires: no automatic-fail condition and the rubric substantially satisfied.',
  'Be harsh but fair; explain the single most important reason in `reasoning`.',
].join('\n')

export async function judge(
  a: Anthropic,
  model: string,
  scenarioTitle: string,
  rubric: string,
  rendered: string,
): Promise<{ judgment: Judgment; usage: { input: number; output: number } }> {
  const msg = await a.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: JUDGE_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `SCENARIO: ${scenarioTitle}\n\nRUBRIC:\n${rubric}\n\nASSISTANT OUTPUT:\n${rendered}`,
      },
    ],
    tools: [EMIT_JUDGMENT as unknown as Anthropic.Tool],
    tool_choice: { type: 'tool', name: 'emit_judgment' },
  })
  const toolUse = msg.content.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('judge returned no judgment')
  return {
    judgment: toolUse.input as Judgment,
    usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens },
  }
}

// ---------- render helpers (what the judge sees) ----------

/** User-visible rendering of a chat: user turns, assistant bodies (status stripped), shown tool
 * lines, confirm gates and their resolutions — the conversation as the user experienced it. */
export function renderChatForJudge(t: ChatTrace): string {
  const lines: string[] = []
  for (const turn of t.turns) {
    if ('say' in turn.input) lines.push(`USER: ${turn.input.say}`)
    else if ('confirm' in turn.input) lines.push('USER: [tapped Confirm]')
    else lines.push(`USER: [tapped Decline${turn.input.note ? ` — "${turn.input.note}"` : ''}]`)
    for (const res of turn.toolResults) {
      if (res.display === null) continue
      lines.push(`  [${res.name}${res.ok ? '' : ' FAILED'}: ${res.display ?? res.summary}]`)
    }
    if (turn.pending) {
      lines.push(`  [confirmation requested: ${turn.pending.summary}]`)
    }
    if (turn.body.trim()) lines.push(`BABYCLAW: ${turn.body.trim()}`)
    if (turn.status) lines.push(`  [status line: ${turn.needsInput ? '? ' : ''}${turn.status}]`)
    if (turn.error) lines.push(`  [ERROR: ${JSON.stringify(turn.error)}]`)
  }
  return lines.join('\n')
}

export function renderPlanForJudge(plan: PlanResult, sc: PlanScenario): string {
  const fixture = sc.tasks
    .map(
      (t) =>
        `- "${t.text}" imp=${t.y} urg=${t.x} due=${t.due ?? '—'}${t.due_time ? ` ${t.due_time}` : ''}` +
        ` size=${t.size ?? '—'}${t.ongoing ? ' ONGOING' : ''}${t.recurring ? ' RECURRING' : ''}` +
        `${t.staged ? ' STAGED' : ''}${t.start_date ? ` starts=${t.start_date}` : ''}`,
    )
    .join('\n')
  return [
    'FIXTURE TASKS:',
    fixture || '(none)',
    sc.schedule ? `SCHEDULE CONFIG: ${JSON.stringify(sc.schedule)}` : '',
    sc.weather ? `WEATHER: ${sc.weather}` : '',
    sc.memories?.length ? `MEMORIES: ${sc.memories.join(' | ')}` : '',
    '',
    'EMITTED PLAN:',
    JSON.stringify(plan, null, 2),
  ]
    .filter(Boolean)
    .join('\n')
}

export function renderRecapForJudge(body: string, sc: RecapScenario): string {
  return ['RECAP REQUEST:', JSON.stringify(sc.request, null, 2), '', 'EMITTED RECAP:', body].join(
    '\n',
  )
}
