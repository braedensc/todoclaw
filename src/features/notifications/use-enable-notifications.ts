import { useCallback } from 'react'
import { usePushSubscription } from './use-push-subscription'
import { useSaveScheduleConfig, useUserSchedule } from '../schedule/use-user-schedule'

// use-enable-notifications — the ONE-CLICK version of the Settings notifications toggle, for the
// first-run setup guide. The Settings panel splits enabling across its draft + Save (so a normal
// save can't wipe the prefs); a brand-new user just wants the button to work. enable() drives both
// halves in order: the device half (permission + push subscription, via usePushSubscription) and
// then the account half (config.notifications.enabled=true, persisted immediately with the same
// first-enable defaults Settings uses — 8 AM plan / 9 PM recap — unless hours are already set).
// Nothing is written unless the subscribe succeeded, so a permission denial leaves config alone.

export interface EnableNotificationsState {
  /** Attempt the full opt-in. Resolves true when notifications are fully on for this device. */
  enable: () => Promise<boolean>
  busy: boolean
  error: string | null
  /** Subscribe failed at Apple's push layer — show the Safari troubleshooting steps. */
  setupFailed: boolean
  supported: boolean
}

export function useEnableNotifications(): EnableNotificationsState {
  const push = usePushSubscription()
  const schedule = useUserSchedule()
  const save = useSaveScheduleConfig()

  const scheduleData = schedule.data
  const subscribe = push.subscribe
  const saveConfig = save.mutateAsync
  const enable = useCallback(async (): Promise<boolean> => {
    const ok = await subscribe()
    if (!ok) return false
    const config = scheduleData?.config ?? {}
    const notifications = config.notifications ?? {}
    try {
      await saveConfig({
        config: {
          ...config,
          notifications: {
            ...notifications,
            enabled: true,
            morningHour: notifications.morningHour ?? 8,
            eveningHour: notifications.eveningHour ?? 21,
          },
        },
        // The ensure-schedule upsert ran at shell mount, so the row (and its timezone) exists;
        // the browser zone is only a fallback for a pathological no-row race.
        timezone: scheduleData?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      return true
    } catch {
      return false
    }
  }, [subscribe, saveConfig, scheduleData])

  return {
    enable,
    busy: push.busy || save.isPending,
    error: push.error ?? (save.isError ? 'Could not save your notification settings.' : null),
    setupFailed: push.setupFailed,
    supported: push.supported,
  }
}
