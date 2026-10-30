import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_STORAGE_KEY } from '../lib/theme'

// A controllable prefers-color-scheme: flip `setOsDark` to fire the MediaQueryList change event.
function stubMatchMedia(initialDark: boolean) {
  let dark = initialDark
  const listeners = new Set<() => void>()
  const mql = {
    get matches() {
      return dark
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  )
  return (next: boolean) => {
    dark = next
    listeners.forEach((l) => l())
  }
}

const root = document.documentElement
let meta: HTMLMetaElement
let style: HTMLStyleElement

// Fresh module per test: the session fallback for an unwritable localStorage is module state.
async function load() {
  return (await import('./use-theme')).useTheme
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  root.className = ''
  root.style.colorScheme = ''
  style = document.createElement('style')
  style.textContent = ':root { --c-bg: 244 239 230; } html.dark { --c-bg: 22 20 17; }'
  document.head.appendChild(style)
  meta = document.createElement('meta')
  meta.name = 'theme-color'
  document.head.appendChild(meta)
})

afterEach(() => {
  style.remove()
  meta.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useTheme', () => {
  it('defaults to system with no stored value, so an OS-dark device renders dark', async () => {
    stubMatchMedia(true)
    const useTheme = await load()
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    expect(result.current.resolved).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
    expect(meta.content).toBe('#161411')
  })

  it('reads a stored preference and ignores garbage', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const useTheme = await load()
    const { result, unmount } = renderHook(() => useTheme())
    expect(result.current.resolved).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
    unmount()

    localStorage.setItem(THEME_STORAGE_KEY, 'dark foo')
    const again = renderHook(() => useTheme())
    expect(again.result.current.preference).toBe('system')
  })

  it('setPreference persists and applies class, colorScheme and theme-color', async () => {
    const useTheme = await load()
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setPreference('dark'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(result.current.resolved).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.style.colorScheme).toBe('dark')
    expect(meta.content).toBe('#161411')

    act(() => result.current.setPreference('light'))
    expect(root.classList.contains('dark')).toBe(false)
    expect(meta.content).toBe('#f4efe6')
  })

  it('follows prefers-color-scheme while the preference is system', async () => {
    const setOsDark = stubMatchMedia(false)
    localStorage.setItem(THEME_STORAGE_KEY, 'system')
    const useTheme = await load()
    const { result } = renderHook(() => useTheme())
    expect(result.current.resolved).toBe('light')

    act(() => setOsDark(true))
    expect(result.current.preference).toBe('system')
    expect(result.current.resolved).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)

    // An explicit choice stops following the OS.
    act(() => result.current.setPreference('light'))
    act(() => setOsDark(true))
    expect(result.current.resolved).toBe('light')
  })

  it('syncs a change made in another tab via the storage event', async () => {
    const useTheme = await load()
    const { result } = renderHook(() => useTheme())
    act(() => {
      localStorage.setItem(THEME_STORAGE_KEY, 'dark')
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }))
    })
    expect(result.current.preference).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('still applies a change for the session when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const useTheme = await load()
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    act(() => result.current.setPreference('dark'))
    expect(result.current.preference).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('works without matchMedia (treats the OS as light)', async () => {
    vi.stubGlobal('matchMedia', undefined)
    localStorage.setItem(THEME_STORAGE_KEY, 'system')
    const useTheme = await load()
    const { result } = renderHook(() => useTheme())
    expect(result.current.resolved).toBe('light')
  })
})
