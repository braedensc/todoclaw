import { execSync } from 'node:child_process'

export interface LocalSupabaseEnv {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
  dbUrl: string
}

const START_HINT =
  'Local Supabase is not reachable. Start it with `supabase start` (Docker), then re-run the golden E2E suite (`npm run test:e2e:golden`).'

let cached: LocalSupabaseEnv | null = null

/**
 * Resolve the *real* local Supabase keys by shelling out to `supabase status -o env`.
 * Fails fast with a clear hint if the stack is down — it never falls back to a remote or
 * dummy DB. The golden suite is local-only by design (ADR-0011 / ADR-0018).
 */
export function resolveLocalSupabaseEnv(): LocalSupabaseEnv {
  if (cached) return cached

  let raw: string
  try {
    raw = execSync('supabase status -o env', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(START_HINT)
  }

  const env = parseEnvOutput(raw)
  const apiUrl = env.API_URL
  const anonKey = env.ANON_KEY
  const serviceRoleKey = env.SERVICE_ROLE_KEY
  const dbUrl = env.DB_URL

  if (!apiUrl || !anonKey || !serviceRoleKey || !dbUrl) {
    // The CLI ran but its output didn't parse into the keys we need — an unexpected format or an
    // unhealthy stack, NOT "not running". Say so honestly rather than the misleading start hint.
    throw new Error(
      'Unexpected `supabase status -o env` output: could not find API_URL / ANON_KEY / ' +
        'SERVICE_ROLE_KEY / DB_URL. Is the local stack healthy? Check `supabase status`.',
    )
  }

  cached = { apiUrl, anonKey, serviceRoleKey, dbUrl }
  return cached
}

// `supabase status -o env` prints KEY=value (or KEY="value") lines. Parse leniently.
function parseEnvOutput(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim() // tolerate leading/trailing indentation across CLI versions
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[match[1]] = value
  }
  return out
}
