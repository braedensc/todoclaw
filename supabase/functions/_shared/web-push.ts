// web-push.ts — Web Push (RFC 8291) message encryption + VAPID (RFC 8292) auth, from scratch on
// WebCrypto. This is the delivery transport for the proactive daily messages (ADR-0031): a plan or
// recap is encrypted end-to-end to the browser's push subscription and POSTed to the push service.
//
// WHY from scratch (no library): the Edge Function tree carries only three deps (anthropic-sdk,
// supabase-js, zod). The push protocol is small, standardized, and fully expressible with
// `crypto.subtle` — so a ~200-line auditable module beats pulling a web-push package (Node-crypto
// based ones don't run on Deno; a WebCrypto jsr lib e.g. @negrel/webpush would work but adds a
// supply-chain surface for code we can pin to the RFC ourselves). Every crypto layer here is proven
// against the published RFC test vectors in web-push.test.ts (RFC 8188 §3.1 and RFC 8291 §5), so a
// regression in any step (ECDH, HKDF, aes128gcm framing) fails a vector, not a user's phone silently.
//
// The layers, bottom-up:
//   1. computeSharedSecret     — ECDH(P-256) between our ephemeral key and the subscription's key.
//   2. deriveWebPushIkm        — RFC 8291 §3.4: mix the ECDH secret with the subscription auth secret.
//   3. deriveContentKeys       — RFC 8188 §2.2: HKDF the IKM+salt into the AES-GCM key and nonce.
//   4. encryptRecord           — RFC 8188 §2: single-record framing (header || aes128gcm ciphertext).
//   5. encryptContent          — composes 1–4 into the full encrypted body for a subscription.
//   6. buildVapidAuth / sendWebPush — RFC 8292 signed JWT + the POST to the push service.
//
// The lower layers take injected key material + salt so tests can reproduce the RFC vectors exactly;
// production (sendWebPush) generates a fresh ephemeral ECDH key pair and random salt per message.

import { decodeBase64Url, encodeBase64Url } from 'jsr:@std/encoding@1/base64url'

// ---------------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------------

/** A browser Push subscription, as produced by `PushManager.subscribe()` and stored server-side. */
export interface PushSubscription {
  endpoint: string
  keys: {
    p256dh: string // base64url of the UA's raw P-256 public key (65 bytes, 0x04 || X || Y)
    auth: string // base64url of the UA's 16-byte auth secret
  }
}

/** VAPID application-server identity (RFC 8292). Server-only secrets. */
export interface VapidKeys {
  publicKey: string // base64url of the raw P-256 public key (65 bytes); also shipped to the client
  privateKey: string // base64url of the 32-byte private scalar (the JWK "d")
  subject: string // "mailto:you@example.com" or an https:// contact URL
}

/** Result of a delivery attempt. `gone` marks a subscription the push service says is dead (404/410). */
export interface PushResult {
  ok: boolean
  status: number
  gone: boolean
}

// ---------------------------------------------------------------------------------------------------
// Small byte helpers
// ---------------------------------------------------------------------------------------------------

const enc = new TextEncoder()

function utf8(s: string): Uint8Array {
  return enc.encode(s)
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

// crypto.subtle (Deno/TS 5.7 lib) types byte inputs as ArrayBufferView<ArrayBuffer>, but a plain
// Uint8Array widens to Uint8Array<ArrayBufferLike>. None of our buffers are SharedArrayBuffer-backed,
// so this cast at the WebCrypto boundary is sound and keeps the call sites free of inline casts.
function ab(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return u as Uint8Array<ArrayBuffer>
}

// ---------------------------------------------------------------------------------------------------
// HKDF (RFC 5869) over HMAC-SHA-256. Web Push only ever needs a single expand block (output ≤ 32B),
// so hkdfExpand takes just the T(1) = HMAC(PRK, info || 0x01) block and truncates.
// ---------------------------------------------------------------------------------------------------

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    ab(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, ab(data)))
}

/** HKDF-Extract: PRK = HMAC(salt, IKM). */
function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, ikm)
}

/** HKDF-Expand for a single output block: first `length` bytes of HMAC(PRK, info || 0x01). */
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const block = await hmacSha256(prk, concat(info, Uint8Array.of(1)))
  return block.slice(0, length)
}

// RFC 8188 §2.2 info strings (note the trailing NUL is part of the string).
const CEK_INFO = utf8('Content-Encoding: aes128gcm\0')
const NONCE_INFO = utf8('Content-Encoding: nonce\0')
// RFC 8291 §3.4 key-combining label.
const WEBPUSH_INFO_PREFIX = utf8('WebPush: info\0')

// ---------------------------------------------------------------------------------------------------
// Layer 1 — ECDH shared secret (P-256). Deno's WebCrypto returns the raw X coordinate (32 bytes),
// which is exactly the `ecdh_secret` the RFC derives.
// ---------------------------------------------------------------------------------------------------

export async function computeSharedSecret(
  asPrivate: CryptoKey,
  uaPublicRaw: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = await crypto.subtle.importKey(
    'raw',
    ab(uaPublicRaw),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  )
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublic }, asPrivate, 256)
  return new Uint8Array(bits)
}

// ---------------------------------------------------------------------------------------------------
// Layer 2 — RFC 8291 §3.4: fold the ECDH secret together with the subscription's auth secret and both
// public keys to get the IKM fed into the RFC 8188 content-encryption step.
// ---------------------------------------------------------------------------------------------------

export async function deriveWebPushIkm(
  ecdhSecret: Uint8Array,
  authSecret: Uint8Array,
  uaPublicRaw: Uint8Array,
  asPublicRaw: Uint8Array,
): Promise<Uint8Array> {
  const prk = await hkdfExtract(authSecret, ecdhSecret)
  const keyInfo = concat(WEBPUSH_INFO_PREFIX, uaPublicRaw, asPublicRaw)
  return hkdfExpand(prk, keyInfo, 32)
}

// ---------------------------------------------------------------------------------------------------
// Layer 3 — RFC 8188 §2.2: derive the AES-128-GCM content-encryption key (16B) and nonce (12B).
// ---------------------------------------------------------------------------------------------------

export interface ContentKeys {
  cek: Uint8Array
  nonce: Uint8Array
}

export async function deriveContentKeys(ikm: Uint8Array, salt: Uint8Array): Promise<ContentKeys> {
  const prk = await hkdfExtract(salt, ikm)
  const cek = await hkdfExpand(prk, CEK_INFO, 16)
  const nonce = await hkdfExpand(prk, NONCE_INFO, 12)
  return { cek, nonce }
}

// ---------------------------------------------------------------------------------------------------
// Layer 4 — RFC 8188 §2 single-record framing. We only ever emit one record (push payloads are tiny),
// so the padding delimiter is always 0x02 (the last-record marker) with no trailing zero padding, and
// the record size in the header is the fixed rs we advertise.
// ---------------------------------------------------------------------------------------------------

const RECORD_SIZE = 4096

function buildHeader(salt: Uint8Array, rs: number, keyid: Uint8Array): Uint8Array {
  const header = new Uint8Array(16 + 4 + 1 + keyid.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, rs, false) // record size, network byte order
  header[20] = keyid.length
  header.set(keyid, 21)
  return header
}

export async function encryptRecord(
  keys: ContentKeys,
  keyid: Uint8Array,
  salt: Uint8Array,
  plaintext: Uint8Array,
  rs: number = RECORD_SIZE,
): Promise<Uint8Array> {
  const record = concat(plaintext, Uint8Array.of(2)) // data || 0x02 last-record delimiter
  const key = await crypto.subtle.importKey('raw', ab(keys.cek), { name: 'AES-GCM' }, false, [
    'encrypt',
  ])
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: ab(keys.nonce), tagLength: 128 },
      key,
      ab(record),
    ),
  )
  return concat(buildHeader(salt, rs, keyid), ciphertext)
}

// ---------------------------------------------------------------------------------------------------
// Layer 5 — full body for a subscription. Deterministic given the ephemeral key pair + salt (tests
// inject the RFC vectors); sendWebPush generates fresh ones.
// ---------------------------------------------------------------------------------------------------

export async function encryptContent(
  payload: Uint8Array,
  uaPublicRaw: Uint8Array,
  authSecret: Uint8Array,
  asPrivate: CryptoKey,
  asPublicRaw: Uint8Array,
  salt: Uint8Array,
  rs: number = RECORD_SIZE,
): Promise<Uint8Array> {
  const ecdhSecret = await computeSharedSecret(asPrivate, uaPublicRaw)
  const ikm = await deriveWebPushIkm(ecdhSecret, authSecret, uaPublicRaw, asPublicRaw)
  const keys = await deriveContentKeys(ikm, salt)
  // The keyid in the aes128gcm header is our ephemeral public key: it is how the UA knows which key
  // to run ECDH against on receipt (RFC 8291 §4).
  return encryptRecord(keys, asPublicRaw, salt, payload, rs)
}

// ---------------------------------------------------------------------------------------------------
// Key material helpers
// ---------------------------------------------------------------------------------------------------

/** Import a raw 32-byte ECDH private scalar together with its raw public point, as a WebCrypto key. */
export function importEcdhPrivateKey(dRaw: Uint8Array, publicRaw: Uint8Array): Promise<CryptoKey> {
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: encodeBase64Url(dRaw),
    x: encodeBase64Url(publicRaw.slice(1, 33)),
    y: encodeBase64Url(publicRaw.slice(33, 65)),
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ])
}

/** Generate a fresh ephemeral P-256 ECDH key pair for one message (the "application server" side). */
async function generateEphemeralKeyPair(): Promise<{
  privateKey: CryptoKey
  publicRaw: Uint8Array
}> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  return { privateKey: kp.privateKey, publicRaw }
}

/** Generate a VAPID key pair (owner setup helper — run once, store the two base64url strings). */
export async function generateVapidKeys(subject: string): Promise<VapidKeys> {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  return { publicKey: encodeBase64Url(publicRaw), privateKey: jwk.d!, subject }
}

// ---------------------------------------------------------------------------------------------------
// Layer 6 — VAPID (RFC 8292). A short-lived ES256 JWT proving we are the registered application server.
// ---------------------------------------------------------------------------------------------------

const VAPID_TOKEN_TTL_SECONDS = 12 * 60 * 60 // 12h — comfortably under the 24h RFC 8292 ceiling.

function b64urlJson(value: unknown): string {
  return encodeBase64Url(utf8(JSON.stringify(value)))
}

async function importVapidSigningKey(vapid: VapidKeys): Promise<CryptoKey> {
  const publicRaw = decodeBase64Url(vapid.publicKey)
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: vapid.privateKey,
    x: encodeBase64Url(publicRaw.slice(1, 33)),
    y: encodeBase64Url(publicRaw.slice(33, 65)),
    ext: true,
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
}

/** Build the `Authorization: vapid t=<jwt>, k=<pubkey>` header for a given push endpoint. */
export async function buildVapidAuth(
  endpoint: string,
  vapid: VapidKeys,
  nowSeconds: number,
): Promise<{ Authorization: string }> {
  const header = { typ: 'JWT', alg: 'ES256' }
  const claims = {
    aud: new URL(endpoint).origin,
    exp: nowSeconds + VAPID_TOKEN_TTL_SECONDS,
    sub: vapid.subject,
  }
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`
  const key = await importVapidSigningKey(vapid)
  // ES256 WebCrypto signatures are already raw r||s (64 bytes) — exactly the JWS encoding, no DER.
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, ab(utf8(signingInput))),
  )
  const jwt = `${signingInput}.${encodeBase64Url(sig)}`
  return { Authorization: `vapid t=${jwt}, k=${vapid.publicKey}` }
}

// ---------------------------------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------------------------------

// Header + one record's ciphertext (payload + 1 delimiter + 16 GCM tag) must fit the advertised record
// size, and most push services cap the body near 4KB. Our messages are a sentence or two, so this is a
// generous guard, not a real limit.
const MAX_PAYLOAD_BYTES = RECORD_SIZE - 16 - 1 - 128

export interface SendOptions {
  ttlSeconds?: number
  urgency?: 'very-low' | 'low' | 'normal' | 'high'
  now?: Date
  fetchImpl?: typeof fetch
}

/**
 * Encrypt `payload` to `subscription` and POST it to the push service. Best-effort by contract: a dead
 * subscription (404/410) returns `{ gone: true }` so the caller can prune it; other non-2xx returns
 * `ok: false`. Network errors still throw (the caller wraps each user in try/catch).
 */
export async function sendWebPush(
  subscription: PushSubscription,
  payload: string | Uint8Array,
  vapid: VapidKeys,
  opts: SendOptions = {},
): Promise<PushResult> {
  const payloadBytes = typeof payload === 'string' ? utf8(payload) : payload
  if (payloadBytes.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`web-push payload too large: ${payloadBytes.length} > ${MAX_PAYLOAD_BYTES}`)
  }

  const uaPublicRaw = decodeBase64Url(subscription.keys.p256dh)
  const authSecret = decodeBase64Url(subscription.keys.auth)
  const { privateKey, publicRaw } = await generateEphemeralKeyPair()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const body = await encryptContent(
    payloadBytes,
    uaPublicRaw,
    authSecret,
    privateKey,
    publicRaw,
    salt,
  )

  const nowSeconds = Math.floor((opts.now?.getTime() ?? Date.now()) / 1000)
  const auth = await buildVapidAuth(subscription.endpoint, vapid, nowSeconds)
  const doFetch = opts.fetchImpl ?? fetch

  const res = await doFetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttlSeconds ?? 28 * 24 * 60 * 60), // 28 days
      Urgency: opts.urgency ?? 'normal',
    },
    // Deno types fetch's body as BufferSource; a Uint8Array<ArrayBufferLike> needs a widening cast.
    body: body as BodyInit,
  })
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 }
}
