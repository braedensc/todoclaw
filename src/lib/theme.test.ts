import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
} from './theme'

describe('theme constants', () => {
  it('pins the storage key and the default', () => {
    expect(THEME_STORAGE_KEY).toBe('todoclaw.theme')
    expect(DEFAULT_THEME_PREFERENCE).toBe('light')
  })
})

describe('parseThemePreference', () => {
  it('accepts exactly the three literals', () => {
    expect(parseThemePreference('light')).toBe('light')
    expect(parseThemePreference('dark')).toBe('dark')
    expect(parseThemePreference('system')).toBe('system')
  })

  it.each([null, undefined, '', 'Dark', ' dark', 'dark foo', 'auto', 1, true, {}])(
    'returns the default for %j',
    (raw) => {
      expect(parseThemePreference(raw)).toBe(DEFAULT_THEME_PREFERENCE)
    },
  )
})

describe('resolveTheme', () => {
  it('explicit choices ignore the OS setting', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('system follows prefers-color-scheme', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
