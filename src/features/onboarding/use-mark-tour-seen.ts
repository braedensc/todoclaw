import { useCallback } from 'react'
import { useSaveScheduleConfig, useUserSchedule } from '../schedule/use-user-schedule'

// The account half of the tour checkmark. localStorage latches it instantly per-context (see
// setup-guide-store.ts / markTourDone), but localStorage is partitioned between a browser tab and
// the installed PWA — so watching the tour in Safari then opening the Home-Screen app would reset
// the check. Mirroring it into config.onboarding.tourSeen makes "I've seen the tour" a durable,
// device-independent fact: use-setup-guide reads the local flag OR this one.
//
// Returns setters, not a value (use-setup-guide reads config.onboarding.tourSeen straight off its
// existing schedule query). Best-effort: a failed save leaves the local latch in place, so the
// checkmark still holds in the context where the tour was taken.
export function useMarkTourSeen(): { markSeen: () => void; clearSeen: () => void } {
  const schedule = useUserSchedule()
  const save = useSaveScheduleConfig()
  const scheduleData = schedule.data
  const saveConfig = save.mutateAsync

  const set = useCallback(
    async (seen: boolean): Promise<void> => {
      const config = scheduleData?.config ?? {}
      // No-op if already in the target state — avoids a redundant write (and a needless query
      // invalidation) every time the tour closes.
      if ((config.onboarding?.tourSeen ?? false) === seen) return
      try {
        await saveConfig({
          config: { ...config, onboarding: { ...config.onboarding, tourSeen: seen } },
          // The ensure-schedule upsert ran at shell mount, so the row + timezone exist; the browser
          // zone is only a fallback for a pathological no-row race (same as use-enable-notifications).
          timezone: scheduleData?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      } catch {
        // best-effort — the local latch already holds the checkmark for this context
      }
    },
    [saveConfig, scheduleData],
  )

  return {
    markSeen: () => void set(true),
    clearSeen: () => void set(false),
  }
}
