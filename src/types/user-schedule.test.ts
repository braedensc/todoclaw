import { describe, expect, it } from 'vitest'
import {
  ScheduleConfigSchema,
  UserScheduleSchema,
  PLAN_NOTES_MAX,
  BABYCLAW_INSTRUCTIONS_MAX,
  COMMITMENTS_MAX,
} from './user-schedule'

describe('ScheduleConfigSchema', () => {
  it('parses an empty config', () => {
    expect(ScheduleConfigSchema.parse({})).toEqual({})
  })

  it('parses a full, valid config', () => {
    const config = {
      location: 'Atlanta, GA',
      weekday: {
        wakeTime: '7:30am',
        workStart: '9:30',
        workEnd: '17:00',
        lunchStart: '12:00',
        lunchEnd: '1:00pm',
        bedtime: '11:00pm',
        freeTimeEstimateHours: 4.5,
      },
      weekend: {
        saturday: { freeTimeEstimateHours: 9 },
        sunday: { freeTimeEstimateHours: 7 },
      },
      commitments: [
        { label: 'Gym', when: 'Tue/Thu 6pm' },
        { label: 'School pickup', when: 'weekdays 3pm' },
      ],
      planNotes: 'Front-load deep work.',
      babyclaw: { tone: 'warm', verbosity: 'brief', customInstructions: 'Keep it short.' },
    }
    expect(() => ScheduleConfigSchema.parse(config)).not.toThrow()
    expect(ScheduleConfigSchema.parse(config).weekday?.workStart).toBe('9:30')
  })

  it('rejects planNotes longer than the cap', () => {
    expect(() =>
      ScheduleConfigSchema.parse({ planNotes: 'x'.repeat(PLAN_NOTES_MAX + 1) }),
    ).toThrow()
  })

  it('rejects babyclaw customInstructions longer than the cap', () => {
    expect(() =>
      ScheduleConfigSchema.parse({
        babyclaw: { customInstructions: 'x'.repeat(BABYCLAW_INSTRUCTIONS_MAX + 1) },
      }),
    ).toThrow()
  })

  it('rejects an unknown babyclaw tone', () => {
    expect(() => ScheduleConfigSchema.parse({ babyclaw: { tone: 'sassy' } })).toThrow()
  })

  it('rejects out-of-range free-time hours', () => {
    expect(() => ScheduleConfigSchema.parse({ weekday: { freeTimeEstimateHours: 30 } })).toThrow()
  })

  it('rejects a commitment with an empty label', () => {
    expect(() => ScheduleConfigSchema.parse({ commitments: [{ label: '  ' }] })).toThrow()
  })

  it('rejects more commitments than the cap', () => {
    const many = Array.from({ length: COMMITMENTS_MAX + 1 }, (_, i) => ({ label: `c${i}` }))
    expect(() => ScheduleConfigSchema.parse({ commitments: many })).toThrow()
  })

  it('strips a legacy running object + longRunWindow instead of failing', () => {
    // Old rows (e.g. Braeden's) still carry running/longRunWindow — they degrade, never crash.
    const parsed = ScheduleConfigSchema.parse({
      location: 'X',
      weekend: { sunday: { freeTimeEstimateHours: 7, longRunWindow: '8:30am–12pm' } },
      running: { race: 'MDI Marathon', currentMPW: 40 },
    } as Record<string, unknown>)
    expect(parsed).toEqual({ location: 'X', weekend: { sunday: { freeTimeEstimateHours: 7 } } })
  })

  it('strips unknown top-level keys rather than failing', () => {
    const parsed = ScheduleConfigSchema.parse({ location: 'X', bogus: 1 } as Record<
      string,
      unknown
    >)
    expect(parsed).toEqual({ location: 'X' })
  })
})

describe('UserScheduleSchema config resilience', () => {
  const row = (config: unknown) => ({
    user_id: 'u1',
    timezone: 'America/New_York',
    config,
    created_at: 't',
    updated_at: 't',
  })

  it('degrades a malformed config to {} instead of throwing (catch)', () => {
    expect(UserScheduleSchema.parse(row({ weekday: 'not-an-object' })).config).toEqual({})
  })

  it('keeps a valid config on the row', () => {
    expect(UserScheduleSchema.parse(row({ location: 'Atlanta' })).config).toEqual({
      location: 'Atlanta',
    })
  })
})
