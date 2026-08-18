import { describe, expect, it } from 'vitest'
import { findPlanTask, isPlanRockDone } from './plan-done'
import type { Task } from '../types/task'

const TZ = 'America/New_York'
// 3pm UTC = 11am in New York on 2026-07-04 — comfortably the same local day.
const NOW = new Date('2026-07-04T15:00:00Z')

function task(over: Partial<Task>): Task {
  return {
    id: 'id',
    user_id: 'u1',
    text: 'task',
    x: 0.5,
    y: 0.5,
    due: null,
    due_time: null,
    staged: false,
    bucket: 'oneoff',
    recurring: null,
    ongoing: false,
    created_at: '2026-07-01T00:00:00Z',
    deleted_at: null,
    completed_at: null,
    start_date: null,
    worked_days: null,
    ...over,
  }
}

const rock = (t: string, taskId: string | null = null) => ({ task: t, taskId })

describe('isPlanRockDone', () => {
  it('matches by taskId against the done map, completed_at, and recurring lastDoneAt=today', () => {
    const tasks = [
      task({ id: 'map', text: 'Map task' }),
      task({ id: 'perm', text: 'Perm task', completed_at: '2026-07-04T14:00:00Z' }),
      task({
        id: 'chore',
        text: 'Chore',
        recurring: { frequencyDays: 3, lastDoneAt: '2026-07-04T13:00:00Z', doneCount: 2 },
      }),
      task({ id: 'open', text: 'Open task' }),
    ]
    const doneMap = { map: true }
    expect(isPlanRockDone(rock('Map task', 'map'), tasks, doneMap, TZ, NOW)).toBe(true)
    expect(isPlanRockDone(rock('Perm task', 'perm'), tasks, doneMap, TZ, NOW)).toBe(true)
    expect(isPlanRockDone(rock('Chore', 'chore'), tasks, doneMap, TZ, NOW)).toBe(true)
    expect(isPlanRockDone(rock('Open task', 'open'), tasks, doneMap, TZ, NOW)).toBe(false)
  })

  it('the id link survives a model paraphrase (rock text ≠ task text)', () => {
    const tasks = [task({ id: 'a', text: 'Taxes' })]
    expect(isPlanRockDone(rock('Knock out the taxes', 'a'), tasks, { a: true }, TZ, NOW)).toBe(true)
  })

  it('a done-map hit works even when the task row is gone (deleted after completion)', () => {
    expect(isPlanRockDone(rock('Vanished', 'gone'), [], { gone: true }, TZ, NOW)).toBe(true)
  })

  it('falls back to exact text for a legacy rock without taskId', () => {
    const tasks = [task({ id: 'a', text: 'Taxes' })]
    expect(isPlanRockDone(rock('Taxes'), tasks, { a: true }, TZ, NOW)).toBe(true)
    expect(isPlanRockDone(rock('Taxes '), tasks, { a: true }, TZ, NOW)).toBe(true) // trimmed
    expect(isPlanRockDone(rock('Knock out the taxes'), tasks, { a: true }, TZ, NOW)).toBe(false)
  })

  it('a recurring chore done YESTERDAY (user-local) is not done', () => {
    const tasks = [
      task({
        id: 'chore',
        text: 'Chore',
        // 2026-07-04T02:00Z = 2026-07-03 22:00 in New York → yesterday there.
        recurring: { frequencyDays: 3, lastDoneAt: '2026-07-04T02:00:00Z', doneCount: 2 },
      }),
    ]
    expect(isPlanRockDone(rock('Chore', 'chore'), tasks, {}, TZ, NOW)).toBe(false)
  })

  it('an ONGOING project rock scratches off on a session logged today, not on an archive', () => {
    // The whole point of the session log: an ongoing project's ✓ never archives it, so waiting for
    // completed_at would leave the plan card un-struck after a full afternoon on the project. NOW is
    // 2026-07-04 in New York. Pairs with recapPlanItems (dispatch.ts) — the two must agree.
    const tasks = [
      task({
        id: 'today',
        text: 'Novel',
        ongoing: true,
        worked_days: ['2026-07-04', '2026-07-03'],
      }),
      task({ id: 'yest', text: 'Deck', ongoing: true, worked_days: ['2026-07-03'] }),
      task({ id: 'never', text: 'Garden', ongoing: true, worked_days: null }),
      // A stale log on a task that is no longer an ongoing project must not strike anything.
      task({ id: 'switched', text: 'Errand', ongoing: false, worked_days: ['2026-07-04'] }),
    ]
    expect(isPlanRockDone(rock('Novel', 'today'), tasks, {}, TZ, NOW)).toBe(true)
    expect(isPlanRockDone(rock('Deck', 'yest'), tasks, {}, TZ, NOW)).toBe(false)
    expect(isPlanRockDone(rock('Garden', 'never'), tasks, {}, TZ, NOW)).toBe(false)
    expect(isPlanRockDone(rock('Errand', 'switched'), tasks, {}, TZ, NOW)).toBe(false)
    // And the legacy text fallback sees the session too.
    expect(isPlanRockDone(rock('Novel'), tasks, {}, TZ, NOW)).toBe(true)
  })

  it('"today" is the USER\'S local day, not the UTC one', () => {
    // 2026-07-04T02:00Z is still 2026-07-03 22:00 in New York, so a session dated 2026-07-03 is
    // TODAY's work there — the same wall-clock day boundary the daily reset uses.
    const lateUtc = new Date('2026-07-04T02:00:00Z')
    const tasks = [task({ id: 'p', text: 'Novel', ongoing: true, worked_days: ['2026-07-03'] })]
    expect(isPlanRockDone(rock('Novel', 'p'), tasks, {}, TZ, lateUtc)).toBe(true)
    // A session two days back is not today's, whatever side of midnight UTC sits on.
    const older = [task({ id: 'p', text: 'Novel', ongoing: true, worked_days: ['2026-07-01'] })]
    expect(isPlanRockDone(rock('Novel', 'p'), older, {}, TZ, lateUtc)).toBe(false)
  })

  it('an authoritative id link beats a same-text different-task false positive', () => {
    // Two tasks share text; the rock is linked to the OPEN one — the other being done must not
    // strike it (the id is the truth, text matching never runs when the linked row exists).
    const tasks = [
      task({ id: 'done-twin', text: 'Call mom' }),
      task({ id: 'open-twin', text: 'Call mom' }),
    ]
    expect(
      isPlanRockDone(rock('Call mom', 'open-twin'), tasks, { 'done-twin': true }, TZ, NOW),
    ).toBe(false)
  })
})

// The row a plan item points at — what the card's checkbox writes to. It has to resolve the SAME
// task the strikethrough tracks, or ticking one item could complete another.
describe('findPlanTask', () => {
  const tasks = [
    task({ id: 'a', text: 'Taxes' }),
    task({ id: 'b', text: 'Call mom' }),
    task({ id: 'c', text: 'Call mom' }),
  ]

  it('resolves by taskId first, even when the model paraphrased the text', () => {
    expect(findPlanTask(rock('Knock out the taxes', 'a'), tasks)?.id).toBe('a')
    // Two tasks share text; the id decides which — text matching never runs.
    expect(findPlanTask(rock('Call mom', 'c'), tasks)?.id).toBe('c')
  })

  it('falls back to exact (trimmed) text for a legacy item with no taskId', () => {
    expect(findPlanTask(rock('Taxes '), tasks)?.id).toBe('a')
    expect(findPlanTask(rock('Knock out the taxes'), tasks)).toBeNull()
  })

  it('is null when nothing matches — a model-invented item or one deleted since planning', () => {
    expect(findPlanTask(rock('Invented', 'ghost'), tasks)).toBeNull()
    expect(findPlanTask(rock(''), tasks)).toBeNull()
  })

  it('still resolves by text when the stamped id no longer exists (task recreated)', () => {
    expect(findPlanTask(rock('Taxes', 'gone'), tasks)?.id).toBe('a')
  })
})
