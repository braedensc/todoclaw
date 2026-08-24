// ongoing-sessions.ts — BabyClaw's WORKED-vs-FINISHED distinction on an ONGOING PROJECT.
//
// Pins PR #347 ("log work sessions instead of archiving, and pace them"), merged 2026-08-18.
// These ran as expectFailUntil while #347 was open; the tags were retired on merge (per the
// harness rule that a tag must genuinely fail on main) and the scenarios are ordinary
// expected-pass now. Before #347, an ongoing project's only ✓/complete path ran set_task_done:
// a user reporting *progress* ("I worked on the novel today") got their standing project stamped
// completed_at, dropped into the Done log, and archived off the board. There was no way at all to
// record chipping away at one.
//
// What each scenario pins:
//  - ongo-log-session-not-complete — progress ⇒ log_work, never complete_task. capabilities/tasks.ts
//    log_work ("NEVER use complete_task for this — on an ongoing project that FINISHES the project
//    for good"), chat-prompt.ts "WORKED vs FINISHED".
//  - ongo-unlog-mistaken-session   — the logged=false take-back path. The RPC collapses an emptied
//    array to NULL, which the capability must read as SUCCESS, not a failure — and un-logging must
//    still never archive anything.
//  - ongo-worked-vs-finished       — BOTH branches in one conversation: progress on project A logs a
//    session, an explicit "finished for good" on project B still archives through the confirmed
//    complete_task. The headline behavior change, and the exact place a mis-steered model destroys
//    data.
//
// The archival canary is the Done-log row, not the column: evals/lib's DbSnapshot doesn't carry
// `worked_days`, so "a session was logged" is asserted as tool-trace + the NEGATIVE of archival —
// completed_at null, not in today's done map, and no history row. A direct dbWorkedToday()
// combinator (the column exists now that #347 is merged) is a reasonable follow-up if these
// indirect checks ever prove too loose.
//
// Chat seeds MUST be now-relative (dayOffsetISO with no base) — the HTTP path can't pin the clock.
// Nothing here depends on the wall-clock hour or the weekday.

import { dayOffsetISO } from '../../lib/fixture-dates.ts'
import {
  confirmRequested,
  dbTaskCompleted,
  dbTaskNotCompleted,
  dbTaskNotDeleted,
  noConfirmRequested,
  noErrorEvents,
  noVisibleLeak,
  statusLineAlways,
  toolCalled,
  toolExecutedOk,
  toolNotCalled,
} from '../../lib/checks.ts'
import type { ChatCheck, ChatScenario } from '../../lib/types.ts'

// ---------- local checks (this file owns them; evals/lib stays untouched) ----------

/** The tool executed against the RIGHT task — the difference between "it logged a session" and
 * "it logged a session on the wrong project". Tool INPUTS never stream over the live SSE protocol
 * (see allToolActivity in lib/checks.ts), so targeting is read from the tool-result display,
 * which interpolates the task's own text: `Logged a work session on "Write the novel" for
 * today.` / `Marked "Clear out the garage" done for today.` */
function toolTargets(name: string, key: string, textRe: RegExp): ChatCheck {
  return (t) => {
    const results = t.turns
      .flatMap((turn) => turn.toolResults)
      .filter((res) => res.name === name && res.ok)
    const hit = results.some((res) => textRe.test(res.display ?? res.summary))
    return {
      name: `${name} targets "${key}"`,
      pass: hit,
      ...(hit
        ? {}
        : {
            detail: results.length
              ? `${name} displays: ${results
                  .map((res) => (res.display ?? res.summary).slice(0, 80))
                  .join(' | ')}`
              : `${name} never executed`,
          }),
    }
  }
}

/** No permanent Done-log row matches — the archival canary. A work session must never produce one
 * (set_task_done, the only writer, inserts the task text into `history`). */
function noHistoryMatching(match: RegExp): ChatCheck {
  return (_t, db) => {
    const hits = db.historyTexts.filter((text) => match.test(text))
    return {
      name: `nothing matching ${match} reached the Done log`,
      pass: hits.length === 0,
      ...(hits.length ? { detail: `logged: ${hits.join(' | ')}` } : {}),
    }
  }
}

/** The mirror: a project the user says is FINISHED does reach the permanent Done log. */
function historyMatches(match: RegExp): ChatCheck {
  return (_t, db) => {
    const hit = db.historyTexts.some((text) => match.test(text))
    return {
      name: `${match} reached the Done log`,
      pass: hit,
      ...(hit ? {} : { detail: `history: ${db.historyTexts.join(' | ') || 'empty'}` }),
    }
  }
}

/** Invention canary over one reply body: the phrase must NOT appear. */
function bodyLacks(turnIdx: number, match: RegExp, label: string): ChatCheck {
  return (t) => {
    const body = t.turns[turnIdx]?.body ?? ''
    const hit = match.test(body)
    return { name: label, pass: !hit, ...(hit ? { detail: body.slice(0, 200) } : {}) }
  }
}

// ---------- fixtures ----------

/** One ongoing project with no session history at all, plus a mundane dated companion so the board
 * isn't a single-task board. `worked_days` is deliberately NOT seeded — evals/lib's db.ts doesn't
 * write it, so every session in these scenarios is created in-conversation. */
const novelSeed = () => ({
  tasks: [
    {
      key: 'novel',
      text: 'Write the novel',
      x: 0.35,
      y: 0.8,
      size: 'XL' as const,
      ongoing: true,
    },
    {
      key: 'dentist',
      text: 'Book the dentist',
      x: 0.7,
      y: 0.4,
      size: 'S' as const,
      due: dayOffsetISO(3),
    },
  ],
})

export const scenarios: ChatScenario[] = [
  {
    kind: 'chat',
    id: 'ongo-log-session-not-complete',
    title: 'Progress on an ongoing project logs a SESSION — it must never archive the project',
    tags: ['ongoing', 'log-work', 'lifecycle', 'regression'],
    persona: 'novelist chipping away at a standing project',
    seed: novelSeed,
    turns: [{ say: 'I worked on the novel for about two hours today — got a chapter drafted.' }],
    checks: [
      toolExecutedOk('log_work'),
      toolTargets('log_work', 'novel', /write the novel/i),
      // The whole point: "I worked on it" is not "it is finished".
      toolNotCalled('complete_task'),
      // log_work is deliberately NOT in the DESTRUCTIVE set (registry.test.ts) — recording progress
      // should not make the user answer a "are you sure?" gate.
      noConfirmRequested(),
      dbTaskNotCompleted('novel'),
      dbTaskNotDeleted('novel'),
      noHistoryMatching(/novel/i),
      // Invention canary: one session is not a run. workedPhrase only says "N days running" at
      // streak >= 2, and this project has no prior sessions at all.
      bodyLacks(0, /days running|streak|on a roll/i, 'no invented streak on a first session'),
      statusLineAlways(),
      noVisibleLeak(),
      noErrorEvents(),
    ],
    // The clause below is INVENTION, not style policing: this project has no prior sessions, so
    // any "days running" is fabricated. Mandate: chat-prompt.ts "Sessions are FACTS, never a
    // scorecard … Do not invent a cadence they are supposed to keep". Note the owner decision of
    // 2026-08-24 — celebrating a run that REALLY happened is fine; only inventing one, framing a
    // cadence they owe, or naming a GAP is banned. The DB truth is deterministic above.
    rubric:
      'The user reports two hours of progress on an ongoing project with no prior sessions ' +
      'logged. FAIL if: the reply congratulates them on finishing, implies the novel is done or ' +
      'archived, or asks whether to mark it complete; it invents a streak, cadence, or ' +
      'expectation from the single session (e.g. "keep it up every day", a fabricated run of ' +
      'days); it frames the session as a score or quota; it scolds or implies they should have ' +
      'started sooner.',
  },
  {
    kind: 'chat',
    id: 'ongo-unlog-mistaken-session',
    title: "Taking back a session they didn't actually do un-logs it, and still archives nothing",
    tags: ['ongoing', 'log-work', 'un-log', 'correction'],
    persona: 'novelist correcting themselves',
    seed: novelSeed,
    turns: [
      { say: 'I put an hour into the novel today.' },
      // Also the supersession clear: a plain `say` drops any gate turn 1 unexpectedly raised.
      {
        say:
          "Actually, scratch that — that was yesterday, I didn't touch the novel today at all. " +
          "Take today's session back off it.",
      },
    ],
    checks: [
      // The un-log is observed via its result display ("Cleared today's session on …",
      // capabilities/tasks.ts:759) — inputs never stream, so logged:false can't be read directly.
      toolCalled('log_work', {
        display: /cleared today'?s session/i,
        label: 'log_work un-log executed (cleared the session)',
      }),
      toolExecutedOk('log_work'),
      // The un-log path returns NULL from the RPC by design (an emptied array collapses to NULL);
      // reading that as a failure would surface a phantom error on the common "actually, I didn't".
      toolNotCalled('complete_task'),
      toolNotCalled('delete_task'),
      dbTaskNotCompleted('novel'),
      dbTaskNotDeleted('novel'),
      noHistoryMatching(/novel/i),
      noConfirmRequested(),
      statusLineAlways(),
      noErrorEvents(),
    ],
  },
  {
    kind: 'chat',
    id: 'ongo-worked-vs-finished',
    title:
      'Both branches in one conversation: progress logs a session, "finished for good" archives',
    tags: ['ongoing', 'log-work', 'complete', 'confirm-gate', 'lifecycle'],
    persona: 'two standing projects, one still running and one genuinely over',
    seed: () => ({
      tasks: [
        {
          key: 'novel',
          text: 'Write the novel',
          x: 0.35,
          y: 0.8,
          size: 'XL' as const,
          ongoing: true,
        },
        {
          key: 'garage',
          text: 'Clear out the garage',
          x: 0.45,
          y: 0.5,
          size: 'L' as const,
          ongoing: true,
        },
      ],
    }),
    turns: [
      { say: 'Spent the morning on the novel — got a chapter drafted.' },
      {
        say:
          "And the garage is finished for good — it's completely cleared out, I'm done with that " +
          'project entirely.',
      },
      { confirm: true },
    ],
    checks: [
      // Branch A: progress ⇒ a session, project untouched.
      toolExecutedOk('log_work'),
      toolTargets('log_work', 'novel', /write the novel/i),
      dbTaskNotCompleted('novel'),
      noHistoryMatching(/novel/i),
      // Branch B: explicitly finished ⇒ the ordinary destructive complete path still works.
      toolTargets('complete_task', 'garage', /clear out the garage/i),
      confirmRequested('complete_task'),
      dbTaskCompleted('garage'),
      historyMatches(/garage/i),
      noVisibleLeak(),
      statusLineAlways(),
      // Deliberately NO noErrorEvents(): turn 3 is a scripted {confirm:true}, and chat-driver.ts
      // emits a harness error event when nothing is pending. confirmRequested('complete_task')
      // already fails loudly in exactly that case — asserting both would double-report one failure.
    ],
    // The DB truth of both branches is fully deterministic above; the rubric keeps the narrative
    // side of #347's WORKED-vs-FINISHED split. "Session" is user-facing app vocabulary (APP GUIDE),
    // so only raw tool-name jargon is banned, not the word "session".
    rubric:
      'Two ongoing projects: progress reported on the novel, and the garage declared finished ' +
      'for good (a confirm follows). FAIL if: the reply describes the novel as finished, done, ' +
      'or archived; it treats the garage as merely worked-on or still open after the user ' +
      'confirmed finishing it; it exposes raw tool names or ids (e.g. "log_work", ' +
      '"complete_task") in user-visible text.',
  },
]
