// Deno unit tests for the CORS origin-lock. NOTE: local `supabase functions serve` injects a
// permissive `Access-Control-Allow-Origin: *` at the gateway, so the lock can't be observed via
// curl locally — these tests verify the pure logic that runs in production (where the function's
// own headers are what's returned). Run: deno test --allow-env supabase/functions/_shared/
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { corsHeaders, preflight } from './cors.ts'

Deno.test('echoes an allowed origin from the comma-separated allow-list', () => {
  Deno.env.set('ALLOWED_ORIGIN', 'http://localhost:5173, https://app.example.com')
  assertEquals(
    corsHeaders('https://app.example.com')['Access-Control-Allow-Origin'],
    'https://app.example.com',
  )
})

Deno.test('omits Access-Control-Allow-Origin for a disallowed origin', () => {
  Deno.env.set('ALLOWED_ORIGIN', 'http://localhost:5173')
  assert(!('Access-Control-Allow-Origin' in corsHeaders('https://evil.example.com')))
})

Deno.test('never returns a wildcard for any origin', () => {
  Deno.env.set('ALLOWED_ORIGIN', 'http://localhost:5173')
  for (const o of ['http://localhost:5173', 'https://evil.example.com', null]) {
    assert(corsHeaders(o)['Access-Control-Allow-Origin'] !== '*')
  }
})

Deno.test('defaults to the local Vite origin when ALLOWED_ORIGIN is unset', () => {
  Deno.env.delete('ALLOWED_ORIGIN')
  assertEquals(
    corsHeaders('http://localhost:5173')['Access-Control-Allow-Origin'],
    'http://localhost:5173',
  )
})

Deno.test('preflight returns 204 for OPTIONS and null otherwise', () => {
  const opt = preflight(new Request('http://x/', { method: 'OPTIONS' }))
  assertEquals(opt?.status, 204)
  assertEquals(preflight(new Request('http://x/', { method: 'POST' })), null)
})
