// checks.ts — the deterministic assertion library scenarios compose. Every combinator returns a
// named CheckResult so the report reads like a spec. Free (no API calls) and run on every scenario.

import type {
  ChatCheck,
  ChatTrace,
  CheckResult,
  DbSnapshot,
  DbTaskRow,
  PlanCheck,
  RecapCheck,
} from './types.ts'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function r(name: string, pass: boolean, detail?: string): CheckResult {
  return { name, pass, ...(detail ? { detail } : {}) }
}

function allToolResults(t: ChatTrace) {
  return t.turns.flatMap((turn) => turn.toolResults)
}

/** Every tool call the live wire lets us OBSERVE. The ai-chat SSE protocol never streams
 * tool_use blocks (the `message` event fires only for the final, tool-free assistant message),
 * so on a real run tool activity is visible ONLY as tool-result events (executed) and
 * tool-pending-confirmation events (proposed, awaiting the gate). `turn.toolUses` is unioned in
 * for forward-compat and for driver unit fixtures, but is ALWAYS empty on the live path — a
 * check must never rely on it alone (that bug shipped in #323 and made toolCalled unsatisfiable
 * and toolNotCalled vacuous on every live run until the first ongo- shakedown exposed it). */
function allToolActivity(t: ChatTrace): { name: string; text: string }[] {
  return [
    ...allToolResults(t).map((res) => ({ name: res.name, text: res.display ?? res.summary })),
    ...t.turns.flatMap((turn) =>
      turn.pending ? [{ name: turn.pending.name, text: turn.pending.summary }] : [],
    ),
    ...t.turns.flatMap((turn) =>
      turn.toolUses.map((u) => ({ name: u.name, text: JSON.stringify(u.input ?? {}) })),
    ),
  ]
}

// ---------- chat: tool behavior ----------

/** The tool was called — executed (tool-result) or proposed (pending confirm). `display` narrows
 * to calls whose user-visible result/summary text matches, the live-wire replacement for input
 * predicates (inputs never stream; the display carries the task text and outcome). */
export function toolCalled(name: string, opts?: { display?: RegExp; label?: string }): ChatCheck {
  return (t) => {
    const hits = allToolActivity(t).filter((a) => a.name === name)
    const matched = opts?.display ? hits.some((a) => opts.display!.test(a.text)) : hits.length > 0
    return r(
      opts?.label ?? `tool ${name} called`,
      matched,
      matched
        ? undefined
        : hits.length
          ? `${name} seen, but no display matched ${opts?.display}: ${hits
              .map((a) => a.text.slice(0, 80))
              .join(' | ')}`
          : `tool activity seen: ${
              [...new Set(allToolActivity(t).map((a) => a.name))].join(', ') || 'none'
            }`,
    )
  }
}

export function toolNotCalled(name: string): ChatCheck {
  return (t) => {
    const hits = allToolActivity(t).filter((a) => a.name === name)
    return r(
      `tool ${name} NOT called`,
      hits.length === 0,
      hits.length ? `seen ${hits.length}× (${hits[0].text.slice(0, 80)})` : undefined,
    )
  }
}

/** The tool actually EXECUTED successfully (an ok tool-result — a denied confirm never executes). */
export function toolExecutedOk(name: string): ChatCheck {
  return (t) => {
    const ok = allToolResults(t).some((res) => res.name === name && res.ok)
    return r(`tool ${name} executed ok`, ok)
  }
}

export function toolNotExecuted(name: string): ChatCheck {
  return (t) => {
    const hits = allToolResults(t).filter((res) => res.name === name && res.ok)
    return r(`tool ${name} never executed`, hits.length === 0)
  }
}

/** A destructive confirm gate was raised for this tool (tool-pending-confirmation event). */
export function confirmRequested(name: string): ChatCheck {
  return (t) => {
    const hit = t.turns.some((turn) => turn.pending?.name === name)
    return r(`confirm gate raised for ${name}`, hit)
  }
}

export function noConfirmRequested(): ChatCheck {
  return (t) =>
    r(
      'no confirm gate raised',
      t.turns.every((turn) => !turn.pending),
    )
}

// ---------- chat: reply shape ----------

/** Every assistant reply that streamed text carries a parseable [[status:]] line. */
export function statusLineAlways(): ChatCheck {
  return (t) => {
    const bad = t.turns.filter((turn) => turn.text.trim().length > 0 && turn.status === null)
    return r(
      'status line on every reply',
      bad.length === 0,
      bad.length
        ? `${bad.length} repl${bad.length === 1 ? 'y' : 'ies'} missing [[status:]]`
        : undefined,
    )
  }
}

/** The reply at `turnIdx` signals it is waiting on the user (the `? ` status marker). */
export function waitingStatusAt(turnIdx: number): ChatCheck {
  return (t) => {
    const turn = t.turns[turnIdx]
    return r(`turn ${turnIdx} waits on user`, Boolean(turn?.needsInput))
  }
}

/** No UUIDs / raw JSON braces in USER-VISIBLE text (bodies + shown tool displays).
 * display === null means hidden; undefined falls back to the model-facing summary. */
export function noVisibleLeak(): ChatCheck {
  return (t) => {
    const visible: string[] = []
    for (const turn of t.turns) {
      visible.push(turn.body)
      for (const res of turn.toolResults) {
        if (res.display === null) continue
        visible.push(res.display ?? res.summary)
      }
    }
    const leak = visible.find((v) => UUID_RE.test(v))
    return r(
      'no id/JSON leak in visible text',
      !leak,
      leak ? `leaked: ${leak.slice(0, 120)}` : undefined,
    )
  }
}

export function noErrorEvents(): ChatCheck {
  return (t) => {
    const errs = t.turns.map((turn) => turn.error).filter(Boolean)
    return r(
      'no error events',
      errs.length === 0,
      errs.length ? JSON.stringify(errs[0]).slice(0, 200) : undefined,
    )
  }
}

/** Free-text probe over an assistant reply body. */
export function bodyAt(turnIdx: number, test: RegExp, label: string): ChatCheck {
  return (t) => {
    const body = t.turns[turnIdx]?.body ?? ''
    return r(label, test.test(body), test.test(body) ? undefined : `body: ${body.slice(0, 160)}`)
  }
}

// ---------- chat: DB end-state ----------

function taskByKey(db: DbSnapshot, key: string): DbTaskRow | undefined {
  const id = db.ids.tasks[key]
  return db.tasks.find((row) => row.id === id)
}

export function dbTask(
  key: string,
  predicate: (row: DbTaskRow) => boolean,
  label: string,
): ChatCheck {
  return (_t, db) => {
    const row = taskByKey(db, key)
    if (!row) return r(label, false, `seeded task "${key}" not found`)
    return r(label, predicate(row))
  }
}

/** Task got paused: start_date set to a FUTURE local date (optionally an exact date). */
export function dbTaskPaused(key: string, until?: string): ChatCheck {
  return dbTask(
    key,
    (row) =>
      row.start_date != null &&
      (until ? row.start_date.slice(0, 10) === until : true) &&
      row.completed_at == null &&
      row.deleted_at == null,
    `task "${key}" paused${until ? ` until ${until}` : ''} (not completed/deleted)`,
  )
}

export function dbTaskNotCompleted(key: string): ChatCheck {
  return (_t, db) => {
    const row = taskByKey(db, key)
    if (!row) return r(`task "${key}" not completed`, false, 'seeded task not found')
    const doneToday = Boolean(db.dailyDone[row.id])
    return r(
      `task "${key}" not completed`,
      row.completed_at == null && !doneToday,
      row.completed_at ? 'completed_at set' : doneToday ? 'done flag set today' : undefined,
    )
  }
}

export function dbTaskCompleted(key: string): ChatCheck {
  return (_t, db) => {
    const row = taskByKey(db, key)
    if (!row) return r(`task "${key}" completed`, false, 'seeded task not found')
    return r(`task "${key}" completed`, row.completed_at != null || Boolean(db.dailyDone[row.id]))
  }
}

export function dbTaskDeleted(key: string): ChatCheck {
  return dbTask(key, (row) => row.deleted_at != null, `task "${key}" soft-deleted`)
}

export function dbTaskNotDeleted(key: string): ChatCheck {
  return dbTask(key, (row) => row.deleted_at == null, `task "${key}" still alive`)
}

/** A task matching `where` exists (for create_task scenarios where there is no seed key). */
export function dbTaskCreated(where: (row: DbTaskRow) => boolean, label: string): ChatCheck {
  return (_t, db) =>
    r(
      label,
      db.tasks.some((row) => row.deleted_at == null && where(row)),
    )
}

export function reminderOffsets(key: string, offsets: number[]): ChatCheck {
  return (_t, db) => {
    const id = db.ids.tasks[key]
    const have = db.reminders
      .filter((rem) => rem.task_id === id)
      .map((rem) => rem.offset_minutes)
      .sort((a, b) => a - b)
    const want = [...offsets].sort((a, b) => a - b)
    const pass = have.length === want.length && have.every((v, i) => v === want[i])
    return r(
      `task "${key}" reminders = [${want.join(', ')}]`,
      pass,
      pass ? undefined : `actual: [${have.join(', ')}]`,
    )
  }
}

export function memorySaved(substr: string): ChatCheck {
  return (_t, db) =>
    r(
      `memory saved containing "${substr}"`,
      db.memories.some((m) => m.content.toLowerCase().includes(substr.toLowerCase())),
      `memories: ${db.memories.map((m) => m.content).join(' | ') || 'none'}`,
    )
}

export function noMemorySaved(): ChatCheck {
  return (_t, db) =>
    r('no memory saved', db.memories.length === 0, db.memories.map((m) => m.content).join(' | '))
}

// ---------- plan ----------

export function planHeadline(): PlanCheck {
  return (plan) => r('headline non-empty', plan.headline.trim().length > 0)
}

/** The big rock, when it resolves to a fixture task, must not be an S-size task (prompt rule 3). */
export function bigRockNeverS(): PlanCheck {
  return (plan, sc) => {
    if (!plan.bigRock?.taskId) return r('big rock never S-size', true)
    const task = sc.tasks.find((t) => t.id === plan.bigRock!.taskId)
    return r(
      'big rock never S-size',
      task?.size !== 'S',
      task ? `big rock is "${task.text}" (${task.size})` : undefined,
    )
  }
}

/** Small rocks resolve only to S/M tasks (prompt rule 4: L/XL never a quick win). */
export function smallRocksOnlySM(): PlanCheck {
  return (plan, sc) => {
    const bad = plan.smallRocks.filter((rock) => {
      if (!rock.taskId) return false
      const task = sc.tasks.find((t) => t.id === rock.taskId)
      return task?.size === 'L' || task?.size === 'XL'
    })
    return r('small rocks only S/M', bad.length === 0, bad.map((b) => b.task).join(', '))
  }
}

export function smallRocksAtMost(n: number): PlanCheck {
  return (plan) =>
    r(`≤${n} small rocks`, plan.smallRocks.length <= n, `${plan.smallRocks.length} emitted`)
}

/** No rock resolves to any of these fixture task ids (dormant, staged, completed, decoys). */
export function rocksExclude(ids: string[], label: string): PlanCheck {
  return (plan) => {
    const rockIds = [plan.bigRock, ...plan.smallRocks]
      .filter(Boolean)
      .map((rock) => rock!.taskId)
      .filter(Boolean)
    const bad = rockIds.filter((id) => ids.includes(id as string))
    return r(label, bad.length === 0, bad.length ? `scheduled: ${bad.join(', ')}` : undefined)
  }
}

/** A rest day stays a rest day: no rocks at all for an empty/quiet fixture. */
export function restDay(): PlanCheck {
  return (plan) =>
    r(
      'rest day: no rocks',
      plan.bigRock == null && plan.smallRocks.length === 0,
      `bigRock=${plan.bigRock?.task ?? 'null'}, smallRocks=${plan.smallRocks.length}`,
    )
}

/**
 * The quiet-day nudge contract. The nudge is the no-big-rock-day pointer, so WHEN one is emitted it
 * must (a) resolve to a real listed task and (b) coincide with bigRock === null. This never forces a
 * nudge — a pure rest day with none is valid — it only constrains one that appears. Pairs with a
 * rubric for the non-deterministic quality call (relax vs. a single light focus).
 */
export function nudgeContract(): PlanCheck {
  return (plan) => {
    if (!plan.nudge) return r('nudge: only w/o a big rock, resolves to a task', true)
    const ok = plan.bigRock == null && !!plan.nudge.taskId
    return r(
      'nudge: only w/o a big rock, resolves to a task',
      ok,
      `bigRock=${plan.bigRock?.task ?? 'null'}, nudge="${plan.nudge.task}" taskId=${
        plan.nudge.taskId ?? 'null'
      }`,
    )
  }
}

/** Every emitted rock resolved back to a real fixture task (taskId non-null). */
export function rocksResolve(): PlanCheck {
  return (plan) => {
    const rocks = [plan.bigRock, ...plan.smallRocks].filter(Boolean)
    const unresolved = rocks.filter((rock) => !rock!.taskId)
    return r(
      'all rocks resolve to task ids',
      unresolved.length === 0,
      unresolved.map((rock) => rock!.task).join(', '),
    )
  }
}

/**
 * Deadline coverage (prompt rule 1): every task the fixture marks OVERDUE or DUE TODAY must land
 * somewhere the user sees — a rock, or the derived anchors/chores strips.
 *
 * This is the check whose absence let the reported failure through: the planner spent both quick-win
 * slots on tasks due in 3 and 6 days and dropped one due today, while rule 1 already said due-soon
 * work "must appear". A rule nothing measures is a rule that quietly stops holding.
 *
 * `dueIds` are fixture ids the scenario declares as due-now, so the check stays a lookup rather than
 * re-deriving date math the fixtures already pin.
 */
export function deadlinesCovered(dueIds: string[]): PlanCheck {
  return (plan) => {
    const shown = new Set(
      [
        plan.bigRock?.taskId,
        ...plan.smallRocks.map((rock) => rock.taskId),
        ...(plan.anchors ?? []).map((a) => a.taskId),
        ...(plan.chores ?? []).map((c) => c.taskId),
      ].filter(Boolean) as string[],
    )
    const missing = dueIds.filter((id) => !shown.has(id))
    return r(
      'every overdue / due-today task appears',
      missing.length === 0,
      missing.length ? `missing: ${missing.join(', ')}` : undefined,
    )
  }
}

/**
 * No rock may resolve to a task the fixture marks as undated or far-dated while a due-now task went
 * unplanned. The precedence half of rule 1: covering deadlines beats picking the juiciest project.
 */
export function noFarDatedOverDue(dueIds: string[], farIds: string[]): PlanCheck {
  return (plan) => {
    const rockIds = [plan.bigRock, ...plan.smallRocks]
      .filter(Boolean)
      .map((rock) => rock!.taskId)
      .filter(Boolean) as string[]
    const covered = new Set(
      [
        ...rockIds,
        ...(plan.anchors ?? []).map((a) => a.taskId),
        ...(plan.chores ?? []).map((c) => c.taskId),
      ].filter(Boolean) as string[],
    )
    const uncovered = dueIds.filter((id) => !covered.has(id))
    const farTaken = rockIds.filter((id) => farIds.includes(id))
    return r(
      'no undated/far-dated rock while something due-now is unplanned',
      uncovered.length === 0 || farTaken.length === 0,
      uncovered.length && farTaken.length
        ? `took ${farTaken.join(', ')} but left ${uncovered.join(', ')} unplanned`
        : undefined,
    )
  }
}

// ---------- recap ----------

export function recapSignoff(): RecapCheck {
  return (body) => r('ends with — BabyClaw 🐾', /— BabyClaw 🐾\s*$/.test(body))
}

export function recapMaxWords(n = 120): RecapCheck {
  return (body) => {
    const words = body.trim().split(/\s+/).length
    return r(`≤${n} words`, words <= n + 5, `${words} words`) // small slack for the sign-off
  }
}

export function recapNoHeaders(): RecapCheck {
  return (body) => r('no section headers / ids', !body.includes('===') && !UUID_RE.test(body))
}

/** Invention canary: the recap must not mention any of these decoy strings (they were never in
 * the request). */
export function recapMentionsNone(decoys: string[]): RecapCheck {
  return (body) => {
    const hit = decoys.find((d) => body.toLowerCase().includes(d.toLowerCase()))
    return r('no invented items', !hit, hit ? `mentioned decoy "${hit}"` : undefined)
  }
}

export function recapMentions(needle: string): RecapCheck {
  return (body) =>
    r(`mentions "${needle}"`, body.toLowerCase().includes(needle.toLowerCase()), body.slice(0, 160))
}
