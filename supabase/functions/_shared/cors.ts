// CORS — locked to the app origin, never '*' (port reference Discrepancy #7).
//
// The allow-list comes from the ALLOWED_ORIGIN secret (comma-separated; e.g. the prod Vercel
// URL). It defaults to the local Vite dev origin so local `supabase functions serve` works
// with no secret set. The request's Origin is echoed back ONLY if it is in the allow-list;
// otherwise no Access-Control-Allow-Origin header is sent and the browser blocks the response.

const DEFAULT_ORIGIN = 'http://localhost:5173'

function allowList(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGIN') ?? DEFAULT_ORIGIN
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    Vary: 'Origin',
  }
  if (origin && allowList().includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

// Returns a 204 preflight response for OPTIONS, else null (let the handler run).
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('Origin')) })
  }
  return null
}
