import { describe, expect, it } from 'vitest'
import {
  effectiveReminderDefault,
  reminderLabel,
  REMINDER_DEFAULT_MINUTES,
} from './reminder-offsets'

describe('effectiveReminderDefault', () => {
  it('resolves the config three-state field', () => {
    expect(effectiveReminderDefault(undefined)).toBe(REMINDER_DEFAULT_MINUTES) // never set → 1h
    expect(effectiveReminderDefault(null)).toBeNull() // explicitly off
    expect(effectiveReminderDefault(10)).toBe(10) // a chosen offset
    expect(effectiveReminderDefault(0)).toBe(0) // "at the due time" is not "off"
  })
})

describe('reminderLabel', () => {
  it('reads as a human phrase, distinguishing off / at-time / before', () => {
    expect(reminderLabel(null)).toBe('No reminder')
    expect(reminderLabel(0)).toBe('At due time')
    expect(reminderLabel(60)).toBe('1 hour before')
    expect(reminderLabel(1440)).toBe('1 day before')
  })
})
