// client-ip.ts — derive the real client IP from an Edge Function request, for per-IP throttling.
//
// The naive `x-forwarded-for.split(',')[0]` (leftmost hop) is CLIENT-SPOOFABLE: any caller can
// prepend an arbitrary value to X-Forwarded-For, so an abuser defeats a per-IP throttle just by
// rotating that header. XFF semantics are the reason: the leftmost entry is whatever the ORIGINAL
// client claimed, and each trusted proxy APPENDS the address it actually observed. The spoof-resistant
// source is therefore a header the trusted edge sets itself and strips from client input — every
// *.supabase.co sits behind Cloudflare, which populates `cf-connecting-ip` with the real connecting
// IP and ignores any client-supplied copy. We prefer that (then `x-real-ip`), and only as a last
// resort fall back to the RIGHTMOST X-Forwarded-For hop — the address the nearest trusted proxy saw,
// which the client cannot control — never the leftmost.
//
// Returns '' when nothing usable is present (e.g. local `supabase functions serve`). Callers treat an
// empty IP as "allow, don't record" (see the invite_throttle RPC), so a missing IP neither bypasses a
// real throttle nor locks anyone out.
export function clientIp(req: Request): string {
  const direct = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip')
  if (direct && direct.trim()) return direct.trim()

  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const hops = xff
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
    if (hops.length > 0) return hops[hops.length - 1] // rightmost = last trusted proxy's observation
  }
  return ''
}
