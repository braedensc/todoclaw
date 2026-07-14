// A short, honest privacy notice shown in both AI panels. For the invite-only MVP the original
// opt-in CONSENT GATE is deferred (ADR-0014/0015); this tells users what the AI features do with
// their text, that they run on the owner's key, and that BOTH conversations and memory are now saved
// + user-controllable (persistent-chats ADR). `compact` trims it for the narrow chat slide-over.
export function AiPrivacyNote({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`text-xs text-muted-light ${compact ? '' : 'leading-relaxed'}`}>
      AI runs on the owner's Anthropic key — your task{compact ? ' & message' : ' and message'} text
      is sent to Anthropic to generate responses. Your conversations are saved to your account so
      you can pick them back up
      {compact ? ' (delete any from chat history)' : ' — delete any of them from the chat history'}.
      Anything you ask BabyClaw to remember is saved
      {compact
        ? ' & sent to Anthropic to personalize replies (view, edit, or turn it off in Settings → AI)'
        : ' and sent to Anthropic to personalize replies — view, edit, or delete it, or turn memory' +
          ' off, under Settings → AI'}
      . The planner works fully without AI.
    </p>
  )
}
