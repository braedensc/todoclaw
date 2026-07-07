import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA for Web Push (ADR-0031). injectManifest: we own the service worker (src/sw.ts) so it can
    // handle `push` / `notificationclick`; the plugin still injects the precache list + emits the
    // web manifest and its <link>. Registration is manual (virtual:pwa-register in main.tsx), so
    // injectRegister is off. devOptions.enabled lets the SW run under `vite dev` for local testing.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Todoclaw',
        short_name: 'Todoclaw',
        description: 'Your free-canvas Eisenhower-matrix task planner.',
        theme_color: '#2e2a24',
        background_color: '#f8f2e6',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        // SVG (scales anywhere) + rasterized PNGs for platforms that require fixed sizes. The
        // maskable variant has an opaque background so Android's adaptive-icon crop never shows
        // transparency; apple-touch-icon (iOS) is linked from index.html, not the manifest.
        // Regenerate the PNGs from favicon.svg with `npm run gen:icons`.
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Precache the built app shell (JS/CSS/HTML/fonts) so an installed PWA opens offline.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
      devOptions: { enabled: true, type: 'module' },
    }),
  ],
  // Vercel exposes the deploying commit as VERCEL_GIT_COMMIT_SHA at build time; bake it in as a
  // compile-time constant so Sentry can tag each error with the release that shipped it. Empty
  // string locally / in CI (the var is absent) → main.tsx treats that as "no release". Default to
  // '' rather than undefined: JSON.stringify(undefined) emits the bare token `undefined`, which
  // Vite's define handles specially — '' is safe and collapses to undefined at runtime.
  define: {
    __GIT_COMMIT_SHA__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ''),
    // Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development'. Baked in so Sentry can
    // tag the environment correctly — otherwise import.meta.env.MODE is 'production' for BOTH
    // preview and prod builds (both run `vite build`), and preview errors would masquerade as prod.
    __VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },
})
