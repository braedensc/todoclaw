// Weather + location resolution — both read the ONE wttr.in `?format=j1` payload, which carries
// the forecast AND `nearest_area` (the place wttr.in's geocoder actually picked). Cached ~30min in
// weather_cache (DEFINER get/put).
//
// The weather_cache is SERVER-ONLY: its get/put RPCs are granted to service_role, never to
// `authenticated` (migration 20260722000000). getWeather therefore takes a service-role client and
// uses it SOLELY for those two cache RPCs — it never touches user tables — so an invited user can
// no longer write arbitrary text into another user's cached weather (which the plan prompt folds in
// verbatim). The cached value is always the summary THIS module fetched from wttr.in, or a sentinel.
//
// Weather is OPTIONAL context for Plan My Day: any failure (network, parse, timeout) returns null
// and the plan is built without it. resolveLocation() is the deliberate exception — it exists to
// TELL the user what their location matched, so it reports why it failed instead of swallowing it.
//
// Why nearest_area matters: wttr.in geocodes fuzzily and answers HTTP 200 for a typo, so
// `Portlnad, OR` returns real weather for Roberts, Oregon (~100mi from the intended Portland).
// Status codes cannot catch that; echoing the matched place back to the user is the only thing
// that can. See resolve-location/index.ts and the Settings location field.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

const WEATHER_TTL_SECONDS = 30 * 60
const FETCH_TIMEOUT_MS = 5000

// A location wttr.in can't geocode is cached as this sentinel instead of a summary, so a bad
// stored location costs ONE 5s timeout per TTL window rather than one on every plan run. It can
// never collide with a real summary (summaryOf() always leads with a weather description word)
// and stays legible to anyone eyeballing weather_cache. getWeather() maps it back to null, so it
// can never reach a prompt. Plain ASCII on purpose: a NUL-byte marker is unstorable in `text`.
const NOT_FOUND_SENTINEL = '__location_not_found__'

// Bound on the echoed place label. It is persisted to `user_schedule.config.locationResolved`,
// whose Zod field caps at 120 — and that config parses under `.catch({})`, so an overlong value
// would silently wipe the user's WHOLE config. The frontend field also carries its own `.catch`;
// this is the first of the two guards. Real labels run ~40-60 chars.
const LABEL_MAX = 120

export type ResolveFailure = 'not_found' | 'unavailable'

export type ResolveResult = { ok: true; label: string } | { ok: false; reason: ResolveFailure }

type J1Result =
  | { ok: true; summary: string; label: string | null }
  | { ok: false; reason: ResolveFailure }

// Current-conditions summary for the plan prompt, or null if unavailable for ANY reason.
// Contract: this never throws and never surfaces a failure — weather is additive context.
// `client` MUST be a service-role client (adminClient): the weather_cache RPCs are granted to
// service_role only, and it is used here solely for those two cache calls, nothing else.
export async function getWeather(client: SupabaseClient, location: string): Promise<string | null> {
  const cached = await cacheGet(client, location)
  if (cached === NOT_FOUND_SENTINEL) return null // negative hit — skip the doomed fetch entirely
  if (cached) return cached

  const res = await fetchJ1(location)
  if (res.ok) {
    await cachePut(client, location, res.summary)
    return res.summary
  }
  // Only a definitive not-found is negative-cached. A transient outage must NOT poison the cache
  // for 30min — the next plan run should get a real answer once wttr.in is back.
  if (res.reason === 'not_found') await cachePut(client, location, NOT_FOUND_SENTINEL)
  return null
}

// Resolve a user-typed location to the place wttr.in actually matched, for confirmation in the UI.
// Uncached: it runs once when someone edits their location, and a stale/negative cache entry would
// be worse than a round trip here. Unlike getWeather this reports WHY it failed.
export async function resolveLocation(location: string): Promise<ResolveResult> {
  const res = await fetchJ1(location)
  if (!res.ok) return res
  // A 200 with no usable nearest_area means we can't honestly say what it matched. Report it as
  // unavailable rather than inventing a label or claiming the place doesn't exist.
  if (!res.label) return { ok: false, reason: 'unavailable' }
  return { ok: true, label: res.label }
}

async function fetchJ1(location: string): Promise<J1Result> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
      headers: { 'User-Agent': 'todoclaw/1.0' },
      signal: controller.signal,
    })
    if (!res.ok) {
      // wttr.in signals an ungeocodable place as HTTP 500 with a body starting "location not
      // found" — there is no 404 path (verified 2026-07-14 against typos, gibberish and
      // punctuation). Anything else (real outage, rate limit) is transient.
      //
      // Sniffing body text is admittedly brittle, so the DEFAULT is the softer `unavailable`:
      // if wttr.in ever reworded this, we'd say "couldn't check right now" (retryable, and only
      // costs a cache miss) rather than tell someone their real city doesn't exist.
      const body = await res.text().catch(() => '')
      const notFound = body.toLowerCase().startsWith('location not found')
      return { ok: false, reason: notFound ? 'not_found' : 'unavailable' }
    }
    const w = await res.json()
    const cur = w.current_condition?.[0]
    if (!cur) return { ok: false, reason: 'unavailable' }
    return { ok: true, summary: summaryOf(w, cur), label: areaLabel(w.nearest_area) }
  } catch {
    // Network error, abort (timeout), or malformed JSON — all transient from our side.
    return { ok: false, reason: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

function summaryOf(w: Record<string, any>, cur: Record<string, any>): string {
  const desc = cur.weatherDesc?.[0]?.value ?? 'Unknown'
  const today = w.weather?.[0]
  const hi = today?.maxtempF
  const lo = today?.mintempF
  return (
    `${desc}, ${cur.temp_F}°F (feels ${cur.FeelsLikeF}°F), humidity ${cur.humidity}%` +
    (hi ? `, high ${hi}°F / low ${lo}°F` : '')
  )
}

// "Portland, Oregon, United States of America" from nearest_area's areaName/region/country.
// Every field is wttr.in's own nested [{value}] shape; any of them can be missing or blank.
function areaLabel(area: unknown): string | null {
  const a = Array.isArray(area) ? area[0] : null
  if (!a || typeof a !== 'object') return null
  const pick = (key: string): string => {
    const v = (a as Record<string, unknown>)[key]
    const first = Array.isArray(v) ? (v[0] as { value?: unknown } | undefined) : undefined
    return typeof first?.value === 'string' ? first.value.trim() : ''
  }
  const parts = [pick('areaName'), pick('region'), pick('country')].filter(Boolean)
  // Drop a field that just repeats the one before it ("Singapore, Singapore, Singapore").
  const deduped = parts.filter((p, i) => p.toLowerCase() !== parts[i - 1]?.toLowerCase())
  if (!deduped.length) return null
  return deduped.join(', ').slice(0, LABEL_MAX)
}

async function cacheGet(client: SupabaseClient, location: string): Promise<string | null> {
  try {
    const { data } = await client.rpc('weather_cache_get', {
      p_location: location,
      p_max_age_seconds: WEATHER_TTL_SECONDS,
    })
    return typeof data === 'string' && data.length > 0 ? data : null
  } catch {
    return null // fall through to a fresh fetch
  }
}

async function cachePut(client: SupabaseClient, location: string, data: string): Promise<void> {
  try {
    await client.rpc('weather_cache_put', { p_location: location, p_data: data })
  } catch {
    // caching is best-effort
  }
}
