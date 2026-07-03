import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
// Self-hosted fonts (no external Google Fonts request — privacy). Fraunces (variable)
// for headings, IBM Plex Sans for body/UI. Families are declared in tailwind.config.js.
import '@fontsource-variable/fraunces/index.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import './index.css'

// Sentry "dev mode": only initializes when a DSN is provided (set VITE_SENTRY_DSN in
// .env.local locally / Vercel prod env in production — see docs/SERVICES.md). Without a DSN
// this is a no-op, so error boundaries and tests don't send events. Source maps stay off
// (deliberate — see ADR-0009).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    // Prefer Vercel's VERCEL_ENV ('production' | 'preview' | 'development') so preview deploys are
    // tagged environment=preview, not lumped into production (import.meta.env.MODE is 'production'
    // for every `vite build`). Falls back to MODE off Vercel (local build / dev).
    environment: __VERCEL_ENV__ || import.meta.env.MODE,
    // Release tracking (Stage 6): tag every event with the commit that shipped it, so a new
    // error points at the exact deploy. __GIT_COMMIT_SHA__ is baked in from Vercel's build SHA
    // (vite.config.ts); empty locally → undefined, so Sentry omits the release instead of
    // tagging a bare "todoclaw@".
    release: __GIT_COMMIT_SHA__ ? `todoclaw@${__GIT_COMMIT_SHA__}` : undefined,
  })
}

const queryClient = new QueryClient()

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
