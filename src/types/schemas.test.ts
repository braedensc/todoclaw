import { describe, expect, it } from 'vitest'
import { TaskSchema } from './task'
import { HabitSchema } from './habit'
import { DailyStateSchema } from './daily-state'
import { UserScheduleSchema } from './user-schedule'

// These prove the Zod schemas (the shared types) parse representative DB rows and reject
// malformed ones — they are the runtime guard at the Supabase boundary.

describe('TaskSchema', () => {
  const row = {
    id: 'id',
    user_id: 'u',
    text: 'task',
    x: null,
    y: null,
    due: null,
    due_time: null,
    staged: true,
    bucket: null,
    recurring: null,
    created_at: '2026-06-23T00:00:00Z',
    deleted_at: null,
    completed_at: null,
  }

  it('parses a valid row (null bucket from Stage 1)', () => {
    expect(TaskSchema.parse(row)).toMatchObject({ text: 'task', bucket: null })
  })

  it('accepts the only valid bucket and rejects others', () => {
    expect(TaskSchema.safeParse({ ...row, bucket: 'oneoff' }).success).toBe(true)
    expect(TaskSchema.safeParse({ ...row, bucket: 'weekly' }).success).toBe(false)
  })
})

describe('HabitSchema', () => {
  it('parses a habit with embedded subtasks', () => {
    const habit = HabitSchema.parse({
      id: 'h',
      user_id: 'u',
      text: 'Stretch',
      active: true,
      subtasks: [{ id: 's1', text: 'Calves' }],
      created_at: '2026-06-23T00:00:00Z',
      deleted_at: null,
    })
    expect(habit.subtasks[0]?.text).toBe('Calves')
  })
})

describe('DailyStateSchema', () => {
  it('parses the keyed completion maps incl. the composite subtask key', () => {
    const ds = DailyStateSchema.parse({
      user_id: 'u',
      date: '2026-06-23',
      done: { t1: true },
      done_at: { t1: '2026-06-23T10:00:00Z' },
      habit_done: { h1: true },
      subtask_done: { 'h1:s1': true },
    })
    expect(ds.subtask_done['h1:s1']).toBe(true)
  })
})

describe('UserScheduleSchema', () => {
  const base = {
    user_id: 'u',
    timezone: 'America/New_York',
    config: {},
    created_at: '2026-06-23T00:00:00Z',
    updated_at: '2026-06-23T00:00:00Z',
  }

  it('requires a non-empty timezone', () => {
    expect(UserScheduleSchema.safeParse(base).success).toBe(true)
    expect(UserScheduleSchema.safeParse({ ...base, timezone: '' }).success).toBe(false)
  })
})
