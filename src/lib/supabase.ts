import { createClient } from '@supabase/supabase-js'

// The anon key is public by design — Row Level Security is the real access guard.
// Both vars are typed as string in src/vite-env.d.ts; guard at runtime in case
// .env.local is missing.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env.local and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see docs/SETUP.md).',
  )
}

export const supabase = createClient(url, anonKey)
