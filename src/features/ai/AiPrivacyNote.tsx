// A short, honest privacy notice shown in both AI panels. For the invite-only MVP the original
// opt-in CONSENT GATE is deferred (ADR-0014/0015); this at least tells users what the AI
// features do with their text and that they run on the owner's key. `compact` trims it for the
// narrow chat slide-over.
export function AiPrivacyNote({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`text-xs text-muted-light ${compact ? '' : 'leading-relaxed'}`}>
      AI runs on the owner's Anthropic key — your task{compact ? ' & message' : ' and message'} text
      is sent to Anthropic to generate responses{compact ? '' : ', and your chat isn’t saved'}. The
      planner works fully without AI.
    </p>
  )
}
