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
// .env.local — see docs/SERVICES.md). Without a DSN this is a no-op, so error boundaries
// and tests don't send events. Full production Sentry (live DSN, source maps, alerts,
// release tracking) is wired in Stage 6.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
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
