import { describe, expect, it } from 'vitest'
import { edgeErrorInfo, edgeErrorSlug } from './edge-error'

// A FunctionsHttpError is `{ message, context: Response }`; only the context carries our contract.
function httpError(status: number, body: unknown): unknown {
  return {
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status }),
  }
}

describe('edgeErrorInfo', () => {
  it('recovers the { error: slug } contract and the status from the response body', async () => {
    expect(await edgeErrorInfo(httpError(403, { error: 'forbidden' }))).toEqual({
      slug: 'forbidden',
      status: 403,
    })
  })

  it('keeps the status when the body has no slug', async () => {
    expect(await edgeErrorInfo(httpError(500, { oops: true }))).toEqual({ slug: '', status: 500 })
  })

  it('survives a non-JSON body (a crashed isolate answers with HTML)', async () => {
    const err = { context: new Response('<html>502</html>', { status: 502 }) }
    expect(await edgeErrorInfo(err)).toEqual({ slug: '', status: 502 })
  })

  it('reports no status for a network failure, which has no response at all', async () => {
    expect(await edgeErrorInfo(new TypeError('Failed to fetch'))).toEqual({
      slug: '',
      status: null,
    })
    expect(await edgeErrorInfo(null)).toEqual({ slug: '', status: null })
  })
})

describe('edgeErrorSlug', () => {
  it('is the slug alone', async () => {
    expect(await edgeErrorSlug(httpError(429, { error: 'too_many_requests' }))).toBe(
      'too_many_requests',
    )
  })
})
