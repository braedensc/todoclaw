import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '../lib/theme'

// use-theme — the device-local theme preference (TOD-137). public/theme-boot.js applies the stored
// choice before first paint; this hook takes over once the bundle loads: it re-applies on every
// change, follows `prefers-color-scheme` while the preference is 'system', and syncs other tabs
// through the `storage` event. Pure parsing/resolution lives in src/lib/theme.ts.
//
// Device-local on purpose: Safari and the installed PWA have separate storage partitions (see
// src/types/user-schedule.ts, onboardingSchema), so each can carry its own appearance — which is
// what a person switching a phone to dark expects. Never sent to the server or the AI.

const DARK_QUERY = '(prefers-color-scheme: dark)'

// localStorage can throw (some private-browsing modes). A change made while it is unwritable is
// kept here for the session so it still applies; a successful write (or another tab's) clears it.
let sessionPreference: ThemePreference | null = null

function readPreference(): ThemePreference {
  if (sessionPreference !== null) return sessionPreference
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return parseThemePreference(null)
  }
}

function writePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref)
    sessionPreference = null
  } catch {
    sessionPreference = pref
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(DARK_QUERY)
    : null
}

function readPrefersDark(): boolean {
  return darkQuery()?.matches ?? false
}

const listeners = new Set<() => void>()

function emit(): void {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (e: StorageEvent): void => {
    // key === null is a storage.clear() in another tab.
    if (e.key !== THEME_STORAGE_KEY && e.key !== null) return
    sessionPreference = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  const mql = darkQuery()
  mql?.addEventListener('change', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
    mql?.removeEventListener('change', listener)
  }
}

/** `--c-bg` is an RGB triplet ("244 239 230"); theme-color wants a CSS color. */
function triplet(value: string): string | null {
  const parts = value.trim().split(/\s+/)
  return parts.length === 3 && parts.every((p) => /^\d+$/.test(p))
    ? `#${parts.map((p) => Number(p).toString(16).padStart(2, '0')).join('')}`
    : null
}

/** Apply a resolved theme to <html> and keep the browser chrome on the page background. */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
  const color = triplet(getComputedStyle(root).getPropertyValue('--c-bg'))
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && color) meta.setAttribute('content', color)
}

export interface ThemeState {
  /** What the user chose (or the default). */
  preference: ThemePreference
  /** What is rendered: 'system' resolved against the OS setting. */
  resolved: ResolvedTheme
  setPreference: (pref: ThemePreference) => void
}

export function useTheme(): ThemeState {
  const preference = useSyncExternalStore(subscribe, readPreference)
  const prefersDark = useSyncExternalStore(subscribe, readPrefersDark)
  const resolved = resolveTheme(preference, prefersDark)

  useEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setPreference = useCallback((pref: ThemePreference) => {
    writePreference(pref)
    emit()
  }, [])

  return { preference, resolved, setPreference }
}
