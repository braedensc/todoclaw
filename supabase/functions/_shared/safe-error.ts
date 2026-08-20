// safe-error — classify a caught value for server logs WITHOUT leaking its message or stack.
//
// The AI catch-alls (ai-chat, plan-my-day, run-plan) can catch Anthropic SDK errors whose
// message/stack interpolate request fragments — i.e. the user's task titles and chat text —
// and edge logs are a third-party sink. So `console.error(..., e)` at those sites leaks PII.
// Log this label instead: the error's class name plus, when present, its numeric HTTP status —
// enough to tell a 429 from a 529 from a TypeError, with no payload attached.

export function errorLabel(e: unknown): string {
  if (e instanceof Error) {
    const status = (e as { status?: unknown }).status
    return typeof status === 'number' ? `${e.name} (status ${status})` : e.name
  }
  return `non-Error thrown (${typeof e})`
}
