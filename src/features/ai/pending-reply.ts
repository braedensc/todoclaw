// pending-reply.ts — classify a TYPED reply while a destructive confirmation is pending.
//
// A destructive tool (complete/delete a task, delete a habit, remove a Done-log entry, delete a
// memory) halts for approval. The user may answer by clicking Confirm/Cancel OR by typing — and a
// typed answer isn't always a bare "yes"/"no". "yes, complete it and add milk" both APPROVES the
// pending action and hands the model a follow-up instruction; a whole-string affirmative dropped that
// to a decline, flashing a red "Declined." chip (the reported papercut). This classifier fixes it
// while biasing SAFE for a destructive op: only a clear affirmative confirms; anything else declines
// (the caller passes the words on, so "actually make it Friday instead" still cancels and re-instructs).
//
// Pure + dependency-free so it unit-tests without pulling in supabase/react (see pending-reply.test.ts).

// A whole-string affirmative — a plain "yes" and its variants, nothing more.
const YES_RE =
  /^(?:y|yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|yes please|sure thing|please do)[\s.!]*$/i

// A LEADING affirmative followed by a real trailing clause — "yes, complete it and add milk",
// "sure, and water the plants". The leading token must be an unambiguous yes, then a separator
// (punctuation/whitespace, so a bare space works and "yes and …" folds "and" into the clause), then
// actual content. `\b` keeps "yesterday" / "noon" from tripping it. Group 1 is the trailing clause.
const LEADING_YES_RE =
  /^(?:yes|yeah|yep|yup|sure(?:\s+thing)?|okay|ok|confirm(?:ed)?|please\s+do|do\s+it|go\s+ahead)\b[\s,;:.!—-]+(\S.*)$/i

// The trailing clause opens with a negation/reversal → treat the whole reply as a DECLINE, not a
// confirm (bias SAFE — destructive). Catches "ok no thanks", "yes actually cancel that".
const TRAILING_NEG_RE =
  /^(?:no|nope|nah|not|don['’]?t|do\s+not|cancel|stop|actually|wait|nvm|never\s*mind)\b/i

// A bare "no" adds no words; anything richer rides along to the model as the next instruction.
export const NO_RE = /^(?:n|no|nope|nah|cancel|stop|don['’]?t)[\s.!]*$/i

export type PendingReply = { verdict: 'confirm'; followUp?: string } | { verdict: 'deny' }

// Classify a typed reply to a pending destructive confirmation. `confirm` runs the tool; a `followUp`
// (present ONLY for a leading-yes-with-clause) is the whole reply, which the caller re-sends as the
// next turn so the model acts on the extra instruction. `deny` cancels the pending action.
export function classifyPendingReply(raw: string): PendingReply {
  const t = raw.trim()
  if (YES_RE.test(t)) return { verdict: 'confirm' }
  const m = LEADING_YES_RE.exec(t)
  const clause = m?.[1] ?? ''
  if (m && !TRAILING_NEG_RE.test(clause.trim())) return { verdict: 'confirm', followUp: t }
  return { verdict: 'deny' }
}
