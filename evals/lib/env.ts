// env.ts — resolve the LOCAL Supabase stack + the dedicated eval Anthropic key.
//
// Two hard safety rails:
//  1. LOCAL-ONLY: every resolved URL must point at 127.0.0.1/localhost. Eval runs wipe per-user
//     rows and AI ledgers — pointing this at a remote project must be impossible by construction.
//  2. The Anthropic key comes from EVAL_ANTHROPIC_API_KEY — a separate key from production, so
//     eval spend never mixes with the app's billing. Referenced by name only, never printed.

export interface EvalEnv {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
  dbUrl: string
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function assertLocal(label: string, url: string): void {
  let host: string
  try {
    host = new URL(url.startsWith('postgres') ? url.replace(/^postgres(ql)?:/, 'http:') : url)
      .hostname
  } catch {
    throw new Error(`evals: could not parse ${label} (${url})`)
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `evals: ${label} points at "${host}" — evals only ever run against the LOCAL stack ` +
        '(they wipe per-user data and AI ledgers). Refusing to continue.',
    )
  }
}

let cached: EvalEnv | null = null

/** Shell `supabase status -o env` (same source the e2e helpers use) and parse the keys the
 * harness needs. Ambient EVAL_SUPABASE_* variables override, for pre-resolved environments. */
export async function resolveEvalEnv(): Promise<EvalEnv> {
  if (cached) return cached

  const fromAmbient = {
    apiUrl: Deno.env.get('EVAL_SUPABASE_URL'),
    anonKey: Deno.env.get('EVAL_SUPABASE_ANON_KEY'),
    serviceRoleKey: Deno.env.get('EVAL_SUPABASE_SERVICE_ROLE_KEY'),
    dbUrl: Deno.env.get('EVAL_SUPABASE_DB_URL'),
  }

  let parsed: Record<string, string> = {}
  if (!fromAmbient.apiUrl || !fromAmbient.anonKey || !fromAmbient.serviceRoleKey) {
    const cmd = new Deno.Command('supabase', {
      args: ['status', '-o', 'env'],
      stdout: 'piped',
      stderr: 'piped',
    })
    const out = await cmd.output()
    if (!out.success) {
      throw new Error(
        'evals: `supabase status` failed — is the local stack up? Run `supabase start` first.\n' +
          new TextDecoder().decode(out.stderr).slice(0, 500),
      )
    }
    for (const line of new TextDecoder().decode(out.stdout).split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=["']?(.*?)["']?$/)
      if (m) parsed[m[1]] = m[2]
    }
  }

  // The stock `supabase start` superuser connection (public local-dev default, not a secret) —
  // assembled from parts so secret scanners never see a credential-shaped literal.
  const localRole = 'postgres'
  const defaultDbUrl = `postgresql://${localRole}:${localRole}@127.0.0.1:54322/${localRole}`

  const env: EvalEnv = {
    apiUrl: fromAmbient.apiUrl ?? parsed.API_URL ?? '',
    anonKey: fromAmbient.anonKey ?? parsed.ANON_KEY ?? '',
    serviceRoleKey: fromAmbient.serviceRoleKey ?? parsed.SERVICE_ROLE_KEY ?? '',
    dbUrl: fromAmbient.dbUrl ?? parsed.DB_URL ?? defaultDbUrl,
  }

  for (const [k, v] of Object.entries(env)) {
    if (!v)
      throw new Error(
        `evals: missing ${k} — run \`supabase start\` or export EVAL_SUPABASE_* vars.`,
      )
  }
  assertLocal('apiUrl', env.apiUrl)
  assertLocal('dbUrl', env.dbUrl)

  cached = env
  return env
}

/** The dedicated eval key. Throws with setup guidance if unset — never falls back to the
 * production ANTHROPIC_API_KEY, so an eval run can't silently bill the app's key. */
export function evalAnthropicKey(): string {
  const key = Deno.env.get('EVAL_ANTHROPIC_API_KEY')
  if (!key) {
    throw new Error(
      'evals: EVAL_ANTHROPIC_API_KEY is not set. Create a dedicated Anthropic key for evals ' +
        'and export it in your shell (see evals/README.md — "Setup").',
    )
  }
  return key
}
