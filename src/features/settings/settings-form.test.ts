import { describe, expect, it } from 'vitest'
import type { ScheduleConfig } from '../../types/user-schedule'
import { EMPTY_DRAFT, configToDraft, draftToConfig } from './settings-form'

describe('settings-form', () => {
  it('configToDraft on an empty/absent config gives the empty draft', () => {
    expect(configToDraft(null)).toEqual(EMPTY_DRAFT)
    expect(configToDraft({})).toEqual(EMPTY_DRAFT)
  })

  it('draftToConfig omits empty fields (never persists blank sub-objects)', () => {
    expect(draftToConfig(EMPTY_DRAFT)).toEqual({})
  })

  it('round-trips a filled config through draft and back', () => {
    const config: ScheduleConfig = {
      location: 'Atlanta, GA',
      weekday: {
        workStart: '9:30',
        workEnd: '17:00',
        lunchStart: '12:00',
        freeTimeEstimateHours: 4.5,
      },
      weekend: {
        saturday: { freeTimeEstimateHours: 9 },
        sunday: { freeTimeEstimateHours: 7, longRunWindow: '8:30am–12:00pm' },
      },
      running: { race: 'MDI Marathon', currentMPW: 40 },
      planNotes: 'Front-load deep work.',
      babyclaw: { tone: 'warm', customInstructions: 'Keep it short.' },
    }
    expect(draftToConfig(configToDraft(config))).toEqual(config)
  })

  it('parses number fields and clamps out-of-range values', () => {
    const out = draftToConfig({ ...EMPTY_DRAFT, weekdayFreeHours: '30', currentMPW: '-5' })
    expect(out.weekday?.freeTimeEstimateHours).toBe(24) // clamped to the 0–24 range
    expect(out.running?.currentMPW).toBe(0) // clamped to the 0–300 range
  })

  it('trims text and drops whitespace-only values', () => {
    const out = draftToConfig({ ...EMPTY_DRAFT, location: '   ', planNotes: '  mornings  ' })
    expect(out.location).toBeUndefined()
    expect(out.planNotes).toBe('mornings')
  })
})
