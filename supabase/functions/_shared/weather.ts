// Weather — a plain-English current-conditions summary from wttr.in (?format=j1), cached ~30min
// in weather_cache (DEFINER get/put). Weather is OPTIONAL context for Plan My Day: any failure
// (network, parse, timeout) returns null and the plan is built without it.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.108.2'

const WEATHER_TTL_SECONDS = 30 * 60

export async function getWeather(client: SupabaseClient, location: string): Promise<string | null> {
  try {
    const { data: cached } = await client.rpc('weather_cache_get', {
      p_location: location,
      p_max_age_seconds: WEATHER_TTL_SECONDS,
    })
    if (typeof cached === 'string' && cached.length > 0) return cached
  } catch {
    // fall through to a fresh fetch
  }

  const summary = await fetchWttr(location)
  if (summary) {
    try {
      await client.rpc('weather_cache_put', { p_location: location, p_data: summary })
    } catch {
      // caching is best-effort
    }
  }
  return summary
}

async function fetchWttr(location: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`https://wttr.in/${encodeURIComponent(location)}?format=j1`, {
      headers: { 'User-Agent': 'todoclaw/1.0' },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const w = await res.json()
    const cur = w.current_condition?.[0]
    if (!cur) return null
    const desc = cur.weatherDesc?.[0]?.value ?? 'Unknown'
    const today = w.weather?.[0]
    const hi = today?.maxtempF
    const lo = today?.mintempF
    return (
      `${desc}, ${cur.temp_F}°F (feels ${cur.FeelsLikeF}°F), humidity ${cur.humidity}%` +
      (hi ? `, high ${hi}°F / low ${lo}°F` : '')
    )
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
