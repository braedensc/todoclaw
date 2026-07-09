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
        sunday: { freeTimeEstimateHours: 7 },
      },
      commitments: [{ label: 'Gym', when: 'Tue/Thu 6pm' }, { label: 'School pickup' }],
      planNotes: 'Front-load deep work.',
      babyclaw: { tone: 'warm', customInstructions: 'Keep it short.' },
    }
    expect(draftToConfig(configToDraft(config))).toEqual(config)
  })

  it('parses number fields and clamps out-of-range values', () => {
    const out = draftToConfig({ ...EMPTY_DRAFT, weekdayFreeHours: '30' })
    expect(out.weekday?.freeTimeEstimateHours).toBe(24) // clamped to the 0–24 range
  })

  it('drops commitment rows with a blank label but keeps labeled ones', () => {
    const out = draftToConfig({
      ...EMPTY_DRAFT,
      commitments: [
        { label: '  ', when: 'noise' }, // no label → dropped entirely
        { label: 'Gym', when: '  ' }, // blank when → label kept, when omitted
      ],
    })
    expect(out.commitments).toEqual([{ label: 'Gym' }])
  })

  it('trims text and drops whitespace-only values', () => {
    const out = draftToConfig({ ...EMPTY_DRAFT, location: '   ', planNotes: '  mornings  ' })
    expect(out.location).toBeUndefined()
    expect(out.planNotes).toBe('mornings')
  })

  it('round-trips a notifications block (enabled + name + hours + quiet)', () => {
    const config: ScheduleConfig = {
      notifications: {
        enabled: true,
        name: 'Braeden',
        morningHour: 8,
        eveningHour: 21,
        quietStartHour: 22,
        quietEndHour: 7,
      },
    }
    expect(draftToConfig(configToDraft(config))).toEqual(config)
  })

  it('a normal save preserves an existing notifications block (anti-clobber)', () => {
    // The Settings panel saves the WHOLE config from the draft. Editing an unrelated field and
    // saving must NOT drop notifications — the regression this whole draft integration guards against.
    const config: ScheduleConfig = {
      location: 'Atlanta',
      notifications: { enabled: true, morningHour: 8, eveningHour: 21 },
    }
    const draft = configToDraft(config)
    const saved = draftToConfig({ ...draft, planNotes: 'new note' })
    expect(saved.notifications).toEqual({ enabled: true, morningHour: 8, eveningHour: 21 })
    expect(saved.planNotes).toBe('new note')
  })

  it('persists hour prefs even when disabled; keeps `enabled` only when true', () => {
    const out = draftToConfig({ ...EMPTY_DRAFT, notificationsEnabled: false, morningHour: '8' })
    expect(out.notifications).toEqual({ morningHour: 8 }) // hour kept; no enabled key
  })

  it('clamps notification hours to 0–23', () => {
    const out = draftToConfig({
      ...EMPTY_DRAFT,
      notificationsEnabled: true,
      morningHour: '25',
      eveningHour: '-3',
    })
    expect(out.notifications?.morningHour).toBe(23)
    expect(out.notifications?.eveningHour).toBe(0)
  })

  describe('reminder default (three-state)', () => {
    it('EMPTY_DRAFT (the app default, 60) does not persist reminderDefaultMinutes', () => {
      // Selecting/leaving the 1-hour default reads back as the default without bloating config.
      expect(draftToConfig(EMPTY_DRAFT).notifications).toBeUndefined()
      expect(configToDraft({}).reminderDefault).toBe('60')
    })

    it("'off' persists null and round-trips", () => {
      const out = draftToConfig({ ...EMPTY_DRAFT, reminderDefault: 'off' })
      expect(out.notifications).toEqual({ reminderDefaultMinutes: null })
      expect(configToDraft(out).reminderDefault).toBe('off')
    })

    it('a non-default preset persists the number and round-trips', () => {
      const out = draftToConfig({ ...EMPTY_DRAFT, reminderDefault: '10' })
      expect(out.notifications).toEqual({ reminderDefaultMinutes: 10 })
      expect(configToDraft(out).reminderDefault).toBe('10')
    })
  })
})
