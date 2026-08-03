// Vector tests for web-push.ts. The point of doing the crypto from scratch is that it is provable:
// every layer is pinned to a published RFC test vector, so a regression fails here instead of on a
// user's phone. Run: deno test --allow-env --no-check supabase/functions/_shared/web-push.test.ts
//
//   RFC 8188 §3.1  — the aes128gcm content-encoding layer (HKDF → key/nonce → single-record framing),
//                    isolated by feeding a fixed IKM (no ECDH).
//   RFC 8291 §5    — the full Web Push stack: ECDH → key-combining → content encryption → body.
//
// Vectors copied verbatim from https://www.rfc-editor.org/rfc/rfc8188 and rfc8291.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { decodeBase64Url, encodeBase64Url } from 'jsr:@std/encoding@1/base64url'
import {
  buildVapidAuth,
  computeSharedSecret,
  deriveContentKeys,
  deriveWebPushIkm,
  encryptContent,
  encryptRecord,
  generateVapidKeys,
  importEcdhPrivateKey,
  isAllowedPushEndpoint,
  sendWebPush,
} from './web-push.ts'

const utf8 = (s: string) => new TextEncoder().encode(s)
const b64 = (bytes: Uint8Array) => encodeBase64Url(bytes)

// --- RFC 8188 §3.1 "Encryption of a Response" ------------------------------------------------------
// Isolates the content-encoding layer: a known IKM + salt must produce the RFC's CEK, nonce, and body.
Deno.test('RFC 8188 §3.1 — content-encoding layer (key/nonce/body)', async () => {
  const ikm = decodeBase64Url('yqdlZ-tYemfogSmv7Ws5PQ')
  const salt = decodeBase64Url('I1BsxtFttlv3u_Oo94xnmw')

  const keys = await deriveContentKeys(ikm, salt)
  assertEquals(b64(keys.cek), '_wniytB-ofscZDh4tbSjHw', 'CEK')
  assertEquals(b64(keys.nonce), 'Bcs8gkIRKLI8GeI8', 'NONCE')

  const body = await encryptRecord(keys, new Uint8Array(0), salt, utf8('I am the walrus'))
  assertEquals(b64(body), 'I1BsxtFttlv3u_Oo94xnmwAAEAAA-NAVub2qFgBEuQKRapoZu-IxkIva3MEB1PD-ly8Thjg')
})

// --- RFC 8291 §5 "Push Message Encryption Example" -------------------------------------------------
// Vectors: the receiver (UA) key, our (application-server) ephemeral key, the auth secret + salt.
const UA_PUBLIC =
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
const AS_PUBLIC =
  'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'
const AS_PRIVATE = 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'
const AUTH_SECRET = 'BTBZMqHH6r4Tts7J_aSIgg'
const MSG_SALT = 'DGv6ra1nlYgDCS1FRnbzlw'
const PLAINTEXT = 'When I grow up, I want to be a watermelon'
const EXPECTED_BODY =
  'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'

Deno.test('RFC 8291 §5 — ECDH shared secret', async () => {
  const asPrivate = await importEcdhPrivateKey(
    decodeBase64Url(AS_PRIVATE),
    decodeBase64Url(AS_PUBLIC),
  )
  const ecdh = await computeSharedSecret(asPrivate, decodeBase64Url(UA_PUBLIC))
  assertEquals(b64(ecdh), 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs')
})

Deno.test('RFC 8291 §5 — key combining (IKM)', async () => {
  const ecdh = decodeBase64Url('kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs')
  const ikm = await deriveWebPushIkm(
    ecdh,
    decodeBase64Url(AUTH_SECRET),
    decodeBase64Url(UA_PUBLIC),
    decodeBase64Url(AS_PUBLIC),
  )
  assertEquals(b64(ikm), 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg')
})

Deno.test('RFC 8291 §5 — content keys (CEK/NONCE)', async () => {
  const ikm = decodeBase64Url('S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg')
  const keys = await deriveContentKeys(ikm, decodeBase64Url(MSG_SALT))
  assertEquals(b64(keys.cek), 'oIhVW04MRdy2XN9CiKLxTg', 'CEK')
  assertEquals(b64(keys.nonce), '4h_95klXJ5E_qnoN', 'NONCE')
})

Deno.test('RFC 8291 §5 — full encrypted body', async () => {
  const asPrivate = await importEcdhPrivateKey(
    decodeBase64Url(AS_PRIVATE),
    decodeBase64Url(AS_PUBLIC),
  )
  const body = await encryptContent(
    utf8(PLAINTEXT),
    decodeBase64Url(UA_PUBLIC),
    decodeBase64Url(AUTH_SECRET),
    asPrivate,
    decodeBase64Url(AS_PUBLIC),
    decodeBase64Url(MSG_SALT),
  )
  assertEquals(b64(body), EXPECTED_BODY)
})

// --- VAPID (RFC 8292): the token must be a verifiable ES256 JWT with the right claims ---------------
Deno.test('VAPID — Authorization header carries a verifiable ES256 JWT', async () => {
  const vapid = await generateVapidKeys('mailto:owner@todoclaw.app')
  const endpoint = 'https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV'
  const nowSeconds = 1_700_000_000

  const { Authorization } = await buildVapidAuth(endpoint, vapid, nowSeconds)
  assert(Authorization.startsWith('vapid t='), 'scheme is vapid')

  const [, tPart, kPart] = Authorization.match(/^vapid t=([^,]+), k=(.+)$/)!
  assertEquals(kPart, vapid.publicKey, 'k= is the VAPID public key')

  const [h, p, s] = tPart.split('.')
  const pub = await crypto.subtle.importKey(
    'raw',
    decodeBase64Url(vapid.publicKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  )
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pub,
    decodeBase64Url(s),
    utf8(`${h}.${p}`),
  )
  assert(verified, 'signature verifies against the VAPID public key')

  const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(p)))
  assertEquals(claims.aud, 'https://push.example.net', 'aud is the endpoint origin')
  assertEquals(claims.sub, 'mailto:owner@todoclaw.app', 'sub is the contact')
  assert(claims.exp > nowSeconds, 'exp is in the future')
  assert(claims.exp - nowSeconds <= 24 * 60 * 60, 'exp within the 24h RFC 8292 ceiling')
})

// --- SSRF guard: only real push-service hosts are sendable (mirrors the DB CHECK) ------------------
Deno.test('isAllowedPushEndpoint — accepts the four push services, rejects everything else', () => {
  // Legit endpoints (FCM exact host; Apple/WNS per-datacenter subdomains; Mozilla exact host).
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://web.push.apple.com/QABC/xyz',
    'https://wns2-par02p.notify.windows.com/w/?token=AwYAAAB',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAA',
  ]) {
    assert(isAllowedPushEndpoint(ok), `should allow ${ok}`)
  }

  // SSRF targets + host-spoofing tricks + non-https must all be refused.
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/abc', // not https
    'https://169.254.169.254/latest/meta-data/', // cloud metadata
    'https://localhost/push',
    'https://127.0.0.1:8080/push',
    'https://fcm.googleapis.com.evil.com/fcm/send/abc', // suffix trick
    'https://fcm.googleapis.com@evil.com/fcm/send/abc', // userinfo trick → host is evil.com
    'https://evil.com/https://fcm.googleapis.com', // host is evil.com
    'https://push.apple.com/x', // bare apex, no service subdomain
    'not a url',
  ]) {
    assert(!isAllowedPushEndpoint(bad), `should reject ${bad}`)
  }
})

Deno.test('sendWebPush — refuses a non-allowlisted endpoint before any fetch', async () => {
  const vapid = await generateVapidKeys('mailto:owner@todoclaw.app')
  let fetched = false
  const spyFetch = (() => {
    fetched = true
    return Promise.resolve(new Response(null, { status: 201 }))
  }) as unknown as typeof fetch
  await assertRejects(
    () =>
      sendWebPush(
        {
          endpoint: 'https://169.254.169.254/push',
          keys: { p256dh: UA_PUBLIC, auth: AUTH_SECRET },
        },
        'hi',
        vapid,
        { fetchImpl: spyFetch },
      ),
    Error,
    'not allowlisted',
  )
  assert(!fetched, 'must not open a connection to a rejected endpoint')
})

// --- Timeout: a stalling endpoint aborts instead of wedging the sweep -------------------------------
Deno.test('sendWebPush — aborts a stalled endpoint via the AbortController timeout', async () => {
  const vapid = await generateVapidKeys('mailto:owner@todoclaw.app')
  // Respect the abort signal; otherwise never resolve — a slowloris endpoint.
  const stallingFetch = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The signal has been aborted', 'AbortError')),
      )
    })) as unknown as typeof fetch

  await assertRejects(
    () =>
      sendWebPush(
        {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
          keys: { p256dh: UA_PUBLIC, auth: AUTH_SECRET },
        },
        'hi',
        vapid,
        { fetchImpl: stallingFetch, timeoutMs: 50 },
      ),
    DOMException,
    'aborted',
  )
})
