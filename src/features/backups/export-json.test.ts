import { describe, expect, it } from 'vitest'
import { buildPlannerExport, exportFilename } from './export-json'
import type { Task } from '../../types/task'
import type { Habit } from '../../types/habit'

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  user_id: 'u1',
  text: 'A task',
  x: 0.5,
  y: 0.5,
  due: null,
  due_time: null,
  staged: false,
  bucket: 'oneoff',
  recurring: null,
  created_at: '2026-07-01T00:00:00.000Z',
  deleted_at: null,
  ...over,
})

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  user_id: 'u1',
  text: 'A habit',
  active: true,
  subtasks: [],
  created_at: '2026-07-01T00:00:00.000Z',
  deleted_at: null,
  ...over,
})

describe('buildPlannerExport', () => {
  const now = new Date('2026-07-02T12:00:00.000Z')

  it('wraps tasks + habits with a version and export timestamp', () => {
    const out = buildPlannerExport([task()], [habit()], now)
    expect(out).toEqual({
      version: 1,
      exportedAt: '2026-07-02T12:00:00.000Z',
      tasks: [task()],
      habits: [habit()],
    })
  })

  it('handles empty content', () => {
    expect(buildPlannerExport([], [], now)).toEqual({
      version: 1,
      exportedAt: '2026-07-02T12:00:00.000Z',
      tasks: [],
      habits: [],
    })
  })

  it('serializes to valid, round-trippable JSON', () => {
    const out = buildPlannerExport([task({ text: 'Quote " and \\ slash' })], [habit()], now)
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
  })
})

describe('exportFilename', () => {
  it('is a date-stamped .json name', () => {
    expect(exportFilename(new Date('2026-07-02T23:30:00.000Z'))).toBe(
      'todoclaw-backup-2026-07-02.json',
    )
  })
})
