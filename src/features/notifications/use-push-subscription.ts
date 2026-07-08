import { useCallback, useState } from 'react'
import { supabase } from '../../lib/supabase'

// use-push-subscription — the browser side of Web Push opt-in (ADR-0031). subscribe() requests the
// Notification permission, subscribes via the service worker's PushManager using the public VAPID
// key, and upserts the resulting endpoint into push_subscriptions (owner RLS). unsubscribe() removes
// both the row and the browser subscription. The dispatcher only sends to users who are BOTH enabled
// (config) AND have a row here — this manages the second half.

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

// applicationServerKey wants a Uint8Array of the URL-safe base64 VAPID public key. The return type is
// pinned to Uint8Array<ArrayBuffer> so it satisfies BufferSource (TS 5.7 widens a bare Uint8Array).
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Encode a raw key (the ArrayBuffer from PushSubscription.getKey) to unpadded base64url — the exact
// format the server decodes (supabase/functions/_shared/web-push.ts). btoa over the byte string,
// then URL-safe swaps + strip padding.
function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac; disambiguate by touch support.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari exposes this non-standard flag for home-screen apps.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export interface PushSubscriptionState {
  supported: boolean
  configured: boolean // a VAPID public key is present
  permission: NotificationPermission
  busy: boolean
  error: string | null
  /** iOS Safari can only receive push once the PWA is installed to the Home Screen. */
  iosInstallHint: boolean
  subscribe: () => Promise<boolean>
  unsubscribe: () => Promise<void>
}

export function usePushSubscription(): PushSubscriptionState {
  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

  const [permission, setPermission] = useState<NotificationPermission>(
    supported ? Notification.permission : 'denied',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported) return false
    if (!VAPID_PUBLIC_KEY) {
      setError('Notifications aren’t configured for this deployment yet.')
      return false
    }
    setBusy(true)
    setError(null)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') {
        if (perm === 'denied') setError('Notifications are blocked in your browser settings.')
        return false
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      // Read the encryption keys via getKey() (raw ArrayBuffers), NOT sub.toJSON().keys — Safari
      // leaves toJSON's keys empty even though getKey() returns them. Encode to base64url ourselves.
      const p256dh = sub.getKey('p256dh')
      const auth = sub.getKey('auth')
      // Safari can RESOLVE subscribe() with a HOLLOW subscription — empty endpoint + zero-length keys —
      // when it fails to register with Apple's push service. This is a known macOS Safari 17.4+ bug
      // (developer.apple.com/forums/thread/759564) with no client-side cure: it reproduces even with a
      // fresh random VAPID key AND a real user gesture, so it's not our code, our key, or a missing
      // gesture. Tear the dead subscription down and point the user at a working browser rather than
      // storing a useless row or throwing a cryptic error.
      if (!sub.endpoint || !p256dh || p256dh.byteLength === 0 || !auth || auth.byteLength === 0) {
        await sub.unsubscribe().catch(() => {})
        setError(
          'Safari couldn’t set up notifications with Apple’s push service — a known issue on some Macs. ' +
            'Chrome, Edge, and Firefox use a different push service and work reliably. To keep using ' +
            'Safari, make sure Location Services and Notifications are enabled in macOS System Settings.',
        )
        return false
      }
      // user_id defaults to auth.uid() (RLS WITH CHECK); we never send it. Re-subscribe upserts.
      const { error: dbError } = await supabase.from('push_subscriptions').upsert(
        {
          endpoint: sub.endpoint,
          p256dh: bufferToBase64Url(p256dh),
          auth: bufferToBase64Url(auth),
        },
        { onConflict: 'endpoint' },
      )
      if (dbError) throw dbError
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enable notifications.')
      return false
    } finally {
      setBusy(false)
    }
  }, [supported])

  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!supported) return
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
    } catch {
      // Best-effort: leaving a stale row is harmless (it's disabled in config), and the push
      // service prunes dead endpoints on the next send (410 → prune_push_subscription).
    } finally {
      setBusy(false)
    }
  }, [supported])

  return {
    supported,
    configured: Boolean(VAPID_PUBLIC_KEY),
    permission,
    busy,
    error,
    iosInstallHint: supported && isIos() && !isStandalone(),
    subscribe,
    unsubscribe,
  }
}
