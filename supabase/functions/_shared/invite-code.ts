// Invite-code helpers (ADR-0029). Shared by generate-invite (mints the code) and tests.
//
// A code is a bearer token that can create a trusted account, so it must be infeasible to guess:
// 16 random bytes = 128 bits of entropy, encoded in Crockford base32 (no I/L/O/U — the letters
// that get mis-typed) → a 26-char, upper-case, phone-typeable string. Entropy is the PRIMARY
// control; single-use + expiry + revoke + the per-IP throttle are defense-in-depth.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** A high-entropy, human-typeable invite code (default 128 bits → 26 Crockford-base32 chars). */
export function generateInviteCode(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)

  let bits = 0
  let value = 0
  let out = ''
  for (const b of bytes) {
    value = (value << 8) | b
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    out += CROCKFORD[(value << (5 - bits)) & 31]
  }
  return out
}

/** The shareable redeem link for a code. `origin` empty → a relative URL the client can complete. */
export function redeemUrl(origin: string, code: string): string {
  return `${origin}/#/redeem?code=${encodeURIComponent(code)}`
}
