import { useCallback } from 'react'
import { useSaveScheduleConfig, useUserSchedule } from '../schedule/use-user-schedule'
import type { ScheduleConfig } from '../../types/user-schedule'

// The ACCOUNT half of the onboarding flags. localStorage latches each one instantly per-context
// (setup-guide-store.ts), but localStorage is partitioned between a browser tab and the installed
// PWA and is discarded whenever site data is cleared — so on its own it kept resurrecting finished
// onboarding: watching the tour in Safari then opening the Home-Screen app reset the check, and
// installing the app brought the whole "Get set up" card back to someone already set up.
//
// Both facts are about the PERSON, not the device, so they mirror into `config.onboarding`:
//   • tourSeen       — the tour has been taken (or deliberately skipped)
//   • setupDismissed — the setup guide is finished with, however it was closed
// use-setup-guide reads the local flag OR the account one, so either half alone holds the state.
//
// Returns setters, not values (callers read `config.onboarding` off their existing schedule query).
// Best-effort: a failed save leaves the local latch in place, so the state still holds in the
// context where the action happened.
//
// NOTE for anything else that writes `user_schedule.config`: the save replaces the jsonb whole, so
// always read-modify-write over the CURRENT config (that's what settings-form's carryOver does).

type OnboardingFlags = NonNullable<ScheduleConfig['onboarding']>

export interface OnboardingMirror {
  markTourSeen: () => void
  clearTourSeen: () => void
  markSetupDismissed: () => void
  clearSetupDismissed: () => void
}

export function useOnboardingMirror(): OnboardingMirror {
  const schedule = useUserSchedule()
  const save = useSaveScheduleConfig()
  const scheduleData = schedule.data
  const saveConfig = save.mutateAsync

  const set = useCallback(
    async (key: keyof OnboardingFlags, value: boolean): Promise<void> => {
      const config = scheduleData?.config ?? {}
      // No-op if already in the target state — avoids a redundant write (and a needless query
      // invalidation) every time the tour closes or the guide auto-dismisses on load.
      if ((config.onboarding?.[key] ?? false) === value) return
      try {
        await saveConfig({
          config: { ...config, onboarding: { ...config.onboarding, [key]: value } },
          // The ensure-schedule upsert ran at shell mount, so the row + timezone exist; the browser
          // zone is only a fallback for a pathological no-row race (same as use-enable-notifications).
          timezone: scheduleData?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      } catch {
        // best-effort — the local latch already holds this flag for this context
      }
    },
    [saveConfig, scheduleData],
  )

  return {
    markTourSeen: () => void set('tourSeen', true),
    clearTourSeen: () => void set('tourSeen', false),
    markSetupDismissed: () => void set('setupDismissed', true),
    clearSetupDismissed: () => void set('setupDismissed', false),
  }
}
