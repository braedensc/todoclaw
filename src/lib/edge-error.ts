// edge-error.ts — recover WHAT actually went wrong from a failed Edge Function call.
//
// supabase.functions.invoke surfaces any non-2xx as a FunctionsHttpError whose `message` is the
// famously useless "Edge Function returned a non-2xx status code" — the response body, where every
// one of our functions puts its `{ error: slug }` contract, is thrown away. Showing that raw message
// to a user (the invite panel used to) tells them nothing, and tells us nothing when they report it.
// So read the body back off the attached Response and hand callers the slug + status to map to copy.
//
// Best-effort by design: a network failure has no Response at all, and a crashed isolate answers
// with HTML, so both fall through to an empty slug and the caller's generic fallback.

export interface EdgeErrorInfo {
  /** The `error` slug from our JSON contract (e.g. 'forbidden'), or '' if unreadable. */
  slug: string
  /** The HTTP status, or null when the request never got a response. */
  status: number | null
}

export async function edgeErrorInfo(err: unknown): Promise<EdgeErrorInfo> {
  const ctx = (err as { context?: Response } | null)?.context
  const status = typeof ctx?.status === 'number' ? ctx.status : null
  if (!ctx || typeof ctx.json !== 'function') return { slug: '', status }
  try {
    const body = (await ctx.json()) as { error?: string }
    return { slug: typeof body?.error === 'string' ? body.error : '', status }
  } catch {
    return { slug: '', status }
  }
}

/** Just the slug, for callers that map every case and don't need the status. */
export async function edgeErrorSlug(err: unknown): Promise<string> {
  return (await edgeErrorInfo(err)).slug
}
