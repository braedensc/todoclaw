// runner.ts — orchestrates a run: filter scenarios, drive each through its kind's pipeline,
// collect deterministic checks + optional judge verdicts into a RunReport.
//
// plan/recap run in-process (pure builders + the eval Anthropic client, clock pinned to PLAN_NOW).
// chat runs against the real local stack: per-scenario user → wipe → seed → converse over SSE →
// DB snapshot → checks. Chat scenarios run SEQUENTIALLY (shared local stack: ledgers, throttles);
// plan/recap run in a small pool.

import type Anthropic from 'npm:@anthropic-ai/sdk@0.105.0'
import { generatePlan } from '../../supabase/functions/_shared/run-plan.ts'
import { generateRecap } from '../../supabase/functions/_shared/run-recap.ts'
import { buildPlanRequest } from '../../supabase/functions/_shared/plan-inputs.ts'
import { DEFAULT_TZ, PLAN_NOW } from './fixture-dates.ts'
import { driveChat } from './chat-driver.ts'
import {
  connectDb,
  ensureUser,
  prepareStack,
  seedScenario,
  signIn,
  snapshotUser,
  wipeUser,
  type Sql,
} from './db.ts'
import { resolveEvalEnv } from './env.ts'
import { judge, renderChatForJudge, renderPlanForJudge, renderRecapForJudge } from './judge.ts'
import type {
  ChatScenario,
  CheckResult,
  PlanScenario,
  RecapScenario,
  Scenario,
  ScenarioResult,
} from './types.ts'

export interface RunOptions {
  anthropic: Anthropic
  judgeClient: Anthropic | null
  judgeModel: string
  mock: boolean
  repeat: number
  concurrency: number
}

const EVAL_PASSWORD = 'eval-scenario-pw-2026'

function flat(results: CheckResult | CheckResult[]): CheckResult[] {
  return Array.isArray(results) ? results : [results]
}

async function maybeJudge(
  opts: RunOptions,
  title: string,
  rubric: string | undefined,
  rendered: string,
  usage: { input: number; output: number },
): Promise<ScenarioResult['judge']> {
  if (!rubric || !opts.judgeClient) return undefined
  const { judgment, usage: ju } = await judge(
    opts.judgeClient,
    opts.judgeModel,
    title,
    rubric,
    rendered,
  )
  usage.input += ju.input
  usage.output += ju.output
  return judgment
}

async function runPlan(sc: PlanScenario, opts: RunOptions): Promise<ScenarioResult> {
  const started = Date.now()
  const usage = { input: 0, output: 0 }
  const base: Omit<ScenarioResult, 'deterministic'> = {
    id: sc.id,
    kind: sc.kind,
    tags: sc.tags,
    title: sc.title,
    ...(sc.expectFailUntil ? { expectFailUntil: sc.expectFailUntil } : {}),
    durationMs: 0,
    usage,
  }
  try {
    const req = buildPlanRequest(
      sc.tasks,
      sc.habits ?? [],
      sc.doneMap ?? {},
      sc.timeZone ?? DEFAULT_TZ,
      PLAN_NOW,
    )
    const { plan, usage: gu } = await generatePlan(
      opts.anthropic,
      req,
      sc.schedule ?? null,
      sc.weather ?? null,
      sc.memories ?? [],
    )
    usage.input += gu.input
    usage.output += gu.output
    const deterministic = opts.mock
      ? [{ name: 'pipeline (mock mode — checks skipped)', pass: true }]
      : (sc.checks ?? []).flatMap((check) => flat(check(plan, sc)))
    const judgeResult = opts.mock
      ? undefined
      : await maybeJudge(opts, sc.title, sc.rubric, renderPlanForJudge(plan, sc), usage)
    return {
      ...base,
      deterministic,
      judge: judgeResult,
      artifact: plan,
      durationMs: Date.now() - started,
    }
  } catch (e) {
    return {
      ...base,
      deterministic: [],
      error: String(e).slice(0, 400),
      durationMs: Date.now() - started,
    }
  }
}

async function runRecap(sc: RecapScenario, opts: RunOptions): Promise<ScenarioResult> {
  const started = Date.now()
  const usage = { input: 0, output: 0 }
  const base: Omit<ScenarioResult, 'deterministic'> = {
    id: sc.id,
    kind: sc.kind,
    tags: sc.tags,
    title: sc.title,
    ...(sc.expectFailUntil ? { expectFailUntil: sc.expectFailUntil } : {}),
    durationMs: 0,
    usage,
  }
  try {
    const { body, usage: gu } = await generateRecap(opts.anthropic, sc.request)
    usage.input += gu.input
    usage.output += gu.output
    const deterministic = opts.mock
      ? [{ name: 'pipeline (mock mode — checks skipped)', pass: true }]
      : (sc.checks ?? []).flatMap((check) => flat(check(body, sc)))
    const judgeResult = opts.mock
      ? undefined
      : await maybeJudge(opts, sc.title, sc.rubric, renderRecapForJudge(body, sc), usage)
    return {
      ...base,
      deterministic,
      judge: judgeResult,
      artifact: body,
      durationMs: Date.now() - started,
    }
  } catch (e) {
    return {
      ...base,
      deterministic: [],
      error: String(e).slice(0, 400),
      durationMs: Date.now() - started,
    }
  }
}

async function runChat(
  sc: ChatScenario,
  opts: RunOptions,
  ctx: { sql: Sql; env: Awaited<ReturnType<typeof resolveEvalEnv>> },
): Promise<ScenarioResult> {
  const started = Date.now()
  const usage = { input: 0, output: 0 } // chat spend is recorded server-side; judge spend lands here
  const base: Omit<ScenarioResult, 'deterministic'> = {
    id: sc.id,
    kind: sc.kind,
    tags: sc.tags,
    title: sc.title,
    ...(sc.expectFailUntil ? { expectFailUntil: sc.expectFailUntil } : {}),
    durationMs: 0,
    usage,
  }
  try {
    const email = `eval-${sc.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}@todoclaw.local`
    const userId = await ensureUser(ctx.env, ctx.sql, email, EVAL_PASSWORD)
    await wipeUser(ctx.sql, userId)
    const ids = await seedScenario(ctx.sql, userId, sc.seed())
    const token = await signIn(ctx.env, email, EVAL_PASSWORD)
    const trace = await driveChat(
      { apiUrl: ctx.env.apiUrl, anonKey: ctx.env.anonKey, token },
      sc.turns,
    )
    const db = await snapshotUser(ctx.sql, userId, ids)
    const deterministic = (sc.checks ?? []).flatMap((check) => flat(check(trace, db)))
    const judgeResult = await maybeJudge(
      opts,
      sc.title,
      sc.rubric,
      renderChatForJudge(trace),
      usage,
    )
    return {
      ...base,
      deterministic,
      judge: judgeResult,
      artifact: renderChatForJudge(trace),
      durationMs: Date.now() - started,
    }
  } catch (e) {
    return {
      ...base,
      deterministic: [],
      error: String(e).slice(0, 400),
      durationMs: Date.now() - started,
    }
  }
}

/** Fail fast (with guidance) if the functions runtime isn't serving. */
async function assertFunctionsServing(apiUrl: string): Promise<void> {
  try {
    const res = await fetch(`${apiUrl}/functions/v1/ai-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    await res.body?.cancel()
  } catch {
    throw new Error(
      'evals: the ai-chat function is not reachable. Start the functions runtime first:\n' +
        '  supabase functions serve --env-file supabase/functions/.env.eval\n' +
        '(see evals/README.md — "Setup").',
    )
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

export async function runScenarios(
  scenarios: Scenario[],
  opts: RunOptions,
): Promise<ScenarioResult[]> {
  const repeated: Scenario[] =
    opts.repeat > 1
      ? scenarios.flatMap((sc) =>
          Array.from(
            { length: opts.repeat },
            (_, i) => ({ ...sc, id: `${sc.id}#${i + 1}` }) as Scenario,
          ),
        )
      : scenarios

  const planRecap = repeated.filter((sc) => sc.kind !== 'chat')
  const chats = repeated.filter((sc): sc is ChatScenario => sc.kind === 'chat')

  const results: ScenarioResult[] = []

  if (planRecap.length) {
    results.push(
      ...(await pool(planRecap, opts.concurrency, (sc) => {
        console.log(`  · ${sc.kind}/${sc.id}`)
        return sc.kind === 'plan' ? runPlan(sc, opts) : runRecap(sc as RecapScenario, opts)
      })),
    )
  }

  if (chats.length) {
    if (opts.mock) {
      console.log(`  (skipping ${chats.length} chat scenario(s) — chat has no mock mode)`)
    } else {
      const env = await resolveEvalEnv()
      await assertFunctionsServing(env.apiUrl)
      const sql = connectDb(env.dbUrl)
      try {
        await prepareStack(sql)
        for (const sc of chats) {
          console.log(`  · chat/${sc.id}`)
          results.push(await runChat(sc, opts, { sql, env }))
        }
      } finally {
        await sql.end()
      }
    }
  }

  return results
}
