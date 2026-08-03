// Deno unit tests for weather.ts. The module's central promise — "any failure returns null and the
// plan is built without it" — was documented but untested until now; a regression there breaks
// Plan My Day for everyone rather than just dropping a line of context, so it's pinned first.
//
// Every test stubs globalThis.fetch: the suite runs without --allow-net and must never touch the
// real wttr.in. Payloads are trimmed copies of a real `?format=j1` response (captured 2026-07-14).
// Run: deno test --allow-env --no-check supabase/functions/_shared/
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'
import { getWeather, resolveLocation } from './weather.ts'

const SENTINEL = '__location_not_found__'

// ---- fixtures --------------------------------------------------------------------------------

function j1(area: { areaName: string; region: string; country: string } | null) {
  return {
    current_condition: [
      {
        weatherDesc: [{ value: 'Partly cloudy' }],
        temp_F: '72',
        FeelsLikeF: '74',
        humidity: '40',
      },
    ],
    weather: [{ maxtempF: '80', mintempF: '60' }],
    nearest_area: area
      ? [
          {
            areaName: [{ value: area.areaName }],
            region: [{ value: area.region }],
            country: [{ value: area.country }],
          },
        ]
      : undefined,
  }
}

const PORTLAND = { areaName: 'Portland', region: 'Oregon', country: 'United States of America' }
// What wttr.in ACTUALLY answers for the typo `Portlnad, OR`: HTTP 200, real weather, wrong town.
const ROBERTS = { areaName: 'Roberts', region: 'Oregon', country: 'United States of America' }

// wttr.in's real not-found shape: HTTP 500 with this body. There is no 404 path.
const notFoundRes = () => new Response('location not found: location not found', { status: 500 })
const okRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

// Swap in a fake fetch for one test, always restoring it. Returns the URLs that were requested.
async function withFetch(
  impl: (url: string) => Response | Promise<Response>,
  run: () => Promise<void>,
) {
  const original = globalThis.fetch
  const urls: string[] = []
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    urls.push(url)
    return Promise.resolve(impl(url))
  }) as typeof fetch
  try {
    await run()
  } finally {
    globalThis.fetch = original
  }
  return urls
}

// A fake client recording every RPC. `cached` seeds what weather_cache_get returns.
function fakeClient(cached: string | null = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args: args ?? {} })
      if (name === 'weather_cache_get') return Promise.resolve({ data: cached, error: null })
      return Promise.resolve({ data: null, error: null })
    },
  } as unknown as SupabaseClient
  const puts = () => calls.filter((c) => c.name === 'weather_cache_put')
  return { client, calls, puts }
}

// ---- getWeather: the null-on-failure contract -------------------------------------------------

Deno.test('getWeather returns a summary and caches it', async () => {
  const { client, puts } = fakeClient()
  let got: string | null = null
  await withFetch(
    () => okRes(j1(PORTLAND)),
    async () => {
      got = await getWeather(client, 'Portland, OR')
    },
  )
  assertEquals(got, 'Partly cloudy, 72°F (feels 74°F), humidity 40%, high 80°F / low 60°F')
  assertEquals(puts()[0]?.args.p_data, got)
})

Deno.test('getWeather returns null for an unknown location', async () => {
  const { client } = fakeClient()
  let got: string | null = 'unset'
  await withFetch(notFoundRes, async () => {
    got = await getWeather(client, 'asdfqwerzxcv')
  })
  assertEquals(got, null)
})

Deno.test('getWeather returns null when wttr.in is down (5xx without the marker)', async () => {
  const { client } = fakeClient()
  let got: string | null = 'unset'
  await withFetch(
    () => new Response('bad gateway', { status: 502 }),
    async () => {
      got = await getWeather(client, 'Portland, OR')
    },
  )
  assertEquals(got, null)
})

Deno.test('getWeather returns null when the network throws', async () => {
  const { client } = fakeClient()
  let got: string | null = 'unset'
  await withFetch(
    () => {
      throw new TypeError('network error')
    },
    async () => {
      got = await getWeather(client, 'Portland, OR')
    },
  )
  assertEquals(got, null)
})

Deno.test('getWeather returns null when the request times out (aborted)', async () => {
  const { client } = fakeClient()
  let got: string | null = 'unset'
  await withFetch(
    () => {
      throw new DOMException('The signal has been aborted', 'AbortError')
    },
    async () => {
      got = await getWeather(client, 'Portland, OR')
    },
  )
  assertEquals(got, null)
})

Deno.test('getWeather returns null on a 200 with a malformed body', async () => {
  const { client } = fakeClient()
  let got: string | null = 'unset'
  await withFetch(
    () => new Response('not json at all', { status: 200 }),
    async () => {
      got = await getWeather(client, 'Portland, OR')
    },
  )
  assertEquals(got, null)
})

Deno.test('getWeather survives a cache RPC that throws (best-effort caching)', async () => {
  const client = {
    rpc: () => {
      throw new Error('rpc exploded')
    },
  } as unknown as SupabaseClient
  let got: string | null = null
  await withFetch(
    () => okRes(j1(PORTLAND)),
    async () => {
      got = await getWeather(client, 'Portland, OR')
    },
  )
  assertStringIncludes(got ?? '', 'Partly cloudy')
})

// ---- getWeather: caching, including the negative cache ----------------------------------------

Deno.test('getWeather serves a cache hit without fetching', async () => {
  const { client } = fakeClient('Sunny, 70°F (feels 70°F), humidity 30%')
  let got: string | null = null
  const urls = await withFetch(
    () => okRes(j1(PORTLAND)),
    async () => {
      got = await getWeather(client, 'Portland, OR')
    },
  )
  assertStringIncludes(got ?? '', 'Sunny')
  assertEquals(urls.length, 0)
})

Deno.test('an unknown location is negative-cached so it stops costing a fetch', async () => {
  const { client, puts } = fakeClient()
  await withFetch(notFoundRes, async () => {
    await getWeather(client, 'asdfqwerzxcv')
  })
  assertEquals(puts()[0]?.args.p_data, SENTINEL)
})

Deno.test('a negative cache hit skips the fetch entirely and still returns null', async () => {
  const { client } = fakeClient(SENTINEL)
  let got: string | null = 'unset'
  const urls = await withFetch(
    () => okRes(j1(PORTLAND)),
    async () => {
      got = await getWeather(client, 'asdfqwerzxcv')
    },
  )
  assertEquals(got, null) // the sentinel must never leak out as a weather summary
  assertEquals(urls.length, 0) // ...and this is the whole point: no doomed 5s round trip
})

Deno.test('a transient outage is NOT negative-cached', async () => {
  // Poisoning the cache for 30min on a blip would suppress weather long after wttr.in recovered.
  const { client, puts } = fakeClient()
  await withFetch(
    () => new Response('bad gateway', { status: 502 }),
    async () => {
      await getWeather(client, 'Portland, OR')
    },
  )
  assertEquals(puts().length, 0)
})

// ---- resolveLocation: the confirmation the UI shows --------------------------------------------

Deno.test('resolveLocation returns the matched place label', async () => {
  let got: unknown
  await withFetch(
    () => okRes(j1(PORTLAND)),
    async () => {
      got = await resolveLocation('Portland, OR')
    },
  )
  assertEquals(got, { ok: true, label: 'Portland, Oregon, United States of America' })
})

Deno.test('resolveLocation surfaces a typo that silently geocodes to the WRONG town', async () => {
  // The bug this whole feature exists for: `Portlnad, OR` is HTTP 200 with real weather, so no
  // status check can catch it. Echoing the matched place back is the only thing that can.
  let got: unknown
  await withFetch(
    () => okRes(j1(ROBERTS)),
    async () => {
      got = await resolveLocation('Portlnad, OR')
    },
  )
  assertEquals(got, { ok: true, label: 'Roberts, Oregon, United States of America' })
})

Deno.test('resolveLocation reports not_found for an unknown place', async () => {
  let got: unknown
  await withFetch(notFoundRes, async () => {
    got = await resolveLocation('asdfqwerzxcv')
  })
  assertEquals(got, { ok: false, reason: 'not_found' })
})

Deno.test(
  'resolveLocation reports unavailable — not not_found — on an unrecognized failure',
  async () => {
    // The deliberate fail-safe: if wttr.in ever rewords its not-found body, we must NOT tell someone
    // their real city doesn't exist. Anything we can't positively identify degrades to "unavailable".
    for (const res of [
      () => new Response('location could not be geocoded', { status: 500 }),
      () => new Response('bad gateway', { status: 502 }),
      () => new Response('rate limited', { status: 429 }),
    ]) {
      let got: unknown
      await withFetch(res, async () => {
        got = await resolveLocation('Portland, OR')
      })
      assertEquals(got, { ok: false, reason: 'unavailable' })
    }
  },
)

Deno.test('resolveLocation reports unavailable when the network throws', async () => {
  let got: unknown
  await withFetch(
    () => {
      throw new TypeError('network error')
    },
    async () => {
      got = await resolveLocation('Portland, OR')
    },
  )
  assertEquals(got, { ok: false, reason: 'unavailable' })
})

Deno.test('resolveLocation reports unavailable rather than invent a label', async () => {
  // A 200 with no usable nearest_area: we cannot honestly say what it matched.
  let got: unknown
  await withFetch(
    () => okRes(j1(null)),
    async () => {
      got = await resolveLocation('Portland, OR')
    },
  )
  assertEquals(got, { ok: false, reason: 'unavailable' })
})

Deno.test('resolveLocation url-encodes the location into the request path', async () => {
  const urls = await withFetch(
    () => okRes(j1(PORTLAND)),
    async () => {
      await resolveLocation('Portland, OR')
    },
  )
  assertEquals(urls[0], 'https://wttr.in/Portland%2C%20OR?format=j1')
})

// ---- label shaping ----------------------------------------------------------------------------

Deno.test('a label drops fields that just repeat the previous one', async () => {
  let got: unknown
  await withFetch(
    () => okRes(j1({ areaName: 'Singapore', region: 'Singapore', country: 'Singapore' })),
    async () => {
      got = await resolveLocation('Singapore')
    },
  )
  assertEquals(got, { ok: true, label: 'Singapore' })
})

Deno.test('a label skips blank fields instead of leaving empty commas', async () => {
  let got: unknown
  await withFetch(
    () => okRes(j1({ areaName: 'Portland', region: '', country: 'United States of America' })),
    async () => {
      got = await resolveLocation('Portland')
    },
  )
  assertEquals(got, { ok: true, label: 'Portland, United States of America' })
})

Deno.test('a label is capped so it can never wipe the stored config', async () => {
  // locationResolved persists into user_schedule.config, which parses under `.catch({})` — an
  // over-cap value there would silently nuke the user's ENTIRE config, not just this field.
  let got: { ok: true; label: string } | { ok: false; reason: string } | undefined
  await withFetch(
    () => okRes(j1({ areaName: 'A'.repeat(200), region: 'B'.repeat(200), country: 'C' })),
    async () => {
      got = await resolveLocation('long')
    },
  )
  assert(got?.ok)
  assertEquals((got as { label: string }).label.length, 120)
})
