/// <reference lib="webworker" />
// Todoclaw service worker (ADR-0031). Its whole job is Web Push: receive a push, show the
// notification, and on click focus/open the app at a deep link (the two-way reply happens in-app,
// not in the notification). Built by vite-plugin-pwa (injectManifest) — it runs in the WebWorker
// lib, so it lives outside the app's tsc pass (excluded in tsconfig.app.json).

declare const self: ServiceWorkerGlobalScope

// vite-plugin-pwa (injectManifest) replaces self.__WB_MANIFEST with the precache list at build. We
// don't run a workbox runtime (no offline routing yet); binding it satisfies the injection point.
const _precache = self.__WB_MANIFEST
void _precache

self.addEventListener('install', () => {
  // Take over immediately so a freshly-subscribed browser can receive pushes without a reload.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

interface PushPayload {
  title: string
  body: string
  tag?: string // collapses repeats of the same message
  url: string // where notificationclick navigates (an in-app hash route, e.g. /#/chat/<id>)
}

// The dispatcher sends JSON; degrade gracefully to text or a generic notice so a push never no-ops.
function readPush(event: PushEvent): PushPayload {
  const fallback: PushPayload = { title: 'Todoclaw', body: 'You have a new update.', url: '/' }
  if (!event.data) return fallback
  try {
    const data = event.data.json() as Partial<PushPayload>
    return {
      title: data.title ?? fallback.title,
      body: data.body ?? fallback.body,
      tag: data.tag,
      url: data.url ?? '/',
    }
  } catch {
    const text = event.data.text()
    return text ? { ...fallback, body: text } : fallback
  }
}

self.addEventListener('push', (event) => {
  const payload = readPush(event)
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: payload.tag,
      data: { url: payload.url },
    }),
  )
})

// Focus an already-open app window (routing it to the deep link) or open a new one.
async function focusOrOpen(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of windows) {
    await client.focus()
    if (url !== '/') {
      try {
        await client.navigate(url)
      } catch {
        // navigate() can reject cross-origin or mid-unload — the focus already surfaced the app.
      }
    }
    return
  }
  await self.clients.openWindow(url)
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data as { url?: string } | null
  event.waitUntil(focusOrOpen(data?.url ?? '/'))
})

// The push service rotated our subscription. The client re-subscribes + upserts on its next open
// (use-push-subscription reads the live subscription), so there is nothing to persist from here.
self.addEventListener('pushsubscriptionchange', () => {
  // Intentionally a no-op — re-subscription is client-driven (needs the VAPID key + a DB write).
})
