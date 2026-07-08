import { describe, expect, it } from 'vitest'
import { deriveBabyClawStatus, toolVerb } from './babyclaw-status'
import type { ChatItem } from '../ai/use-ai-chat'

// Small builders keep the ladder cases readable.
let n = 0
const user = (text: string): ChatItem => ({ id: `u${n++}`, role: 'user', text })
const reply = (text: string): ChatItem => ({ id: `a${n++}`, role: 'assistant', text })
const tool = (text: string, ok = true): ChatItem => ({ id: `t${n++}`, role: 'tool', text, ok })

const base = { paused: false, busy: false, pending: null, error: null, items: [] as ChatItem[] }

describe('deriveBabyClawStatus', () => {
  it('idles with a plain-language hint when there is no history', () => {
    const s = deriveBabyClawStatus(base)
    expect(s.tone).toBe('idle')
    expect(s.text).toMatch(/plain language/i)
  })

  it('shows the paused notice above everything else', () => {
    const s = deriveBabyClawStatus({
      ...base,
      paused: true,
      busy: true,
      items: [tool('Created "x".')],
    })
    expect(s.tone).toBe('paused')
    expect(s.text).toMatch(/paused/i)
  })

  it('shows Working… while busy', () => {
    const s = deriveBabyClawStatus({ ...base, busy: true })
    expect(s.tone).toBe('busy')
    expect(s.text).toBe('Working…')
  })

  it('surfaces a pending confirmation as an answerable yes/no question', () => {
    const s = deriveBabyClawStatus({
      ...base,
      pending: { toolUseId: 'x', summary: 'Move "Call dentist" to the trash' },
    })
    expect(s.tone).toBe('pending')
    expect(s.text).toMatch(/call dentist/i)
    expect(s.text).toMatch(/yes\/no/i)
  })

  it('surfaces a stream/HTTP error (chat.error) inline', () => {
    const s = deriveBabyClawStatus({ ...base, error: 'Slow down a moment — rate limit reached.' })
    expect(s.tone).toBe('error')
    expect(s.icon).toBe('✕')
    expect(s.text).toMatch(/rate limit/i)
  })

  it('reports a successful tool as done ✓ with its short summary', () => {
    const s = deriveBabyClawStatus({
      ...base,
      items: [
        user('add call landlord'),
        tool('Created "call landlord" on the grid.'),
        reply('Added it.'),
      ],
    })
    expect(s.tone).toBe('done')
    expect(s.icon).toBe('✓')
    expect(s.text).toMatch(/call landlord/i)
  })

  it('prefers the concrete tool summary over a plain assistant reply within a turn', () => {
    const s = deriveBabyClawStatus({
      ...base,
      items: [user('add x'), tool('Created "x".'), reply('Done!')],
    })
    expect(s.text).toContain('Created')
  })

  it("prefers BabyClaw's own [[status: …]] line over the tool summary, keeping the tool's tone", () => {
    const s = deriveBabyClawStatus({
      ...base,
      items: [
        user('add x due friday'),
        tool('Created "x" on the grid.'),
        reply('Added it — due Friday!\n[[status: Added "x" — due Friday 🐾]]'),
      ],
    })
    expect(s.tone).toBe('done')
    expect(s.text).toBe('Added "x" — due Friday 🐾')
  })

  it('keeps the error tone from a failed tool even when a status line is present', () => {
    const s = deriveBabyClawStatus({
      ...base,
      items: [
        user('delete y'),
        tool("I couldn't find that task.", false),
        reply("Hmm, I couldn't find it.\n[[status: Couldn't find that task]]"),
      ],
    })
    expect(s.tone).toBe('error')
    expect(s.text).toBe("Couldn't find that task")
  })

  it('uses the status line for a pure reply, and never shows the raw marker', () => {
    const s = deriveBabyClawStatus({
      ...base,
      items: [user('add groceries'), reply('Sure! When is it due?\n[[status: Need a due date!]]')],
    })
    expect(s.tone).toBe('idle')
    expect(s.text).toBe('Need a due date!')
  })

  it('does not pre-clamp long text — width truncation is the CSS layer’s job', () => {
    const long =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen'
    const s = deriveBabyClawStatus({ ...base, items: [user('hm'), reply(long)] })
    expect(s.text).toBe(long)
  })

  it('reports a failed tool as an error', () => {
    const s = deriveBabyClawStatus({
      ...base,
      items: [user('delete y'), tool("I couldn't find that task.", false)],
    })
    expect(s.tone).toBe('error')
    expect(s.icon).toBe('✕')
  })

  it('shows a follow-up question when the latest turn is a pure reply', () => {
    const s = deriveBabyClawStatus({
      ...base,
      items: [user('add groceries'), reply('Sure — add a due date?')],
    })
    expect(s.tone).toBe('idle')
    expect(s.text).toMatch(/due date/i)
  })

  it('does not let a stale tool result mask a fresh pure-reply turn', () => {
    const s = deriveBabyClawStatus({
      ...base,
      items: [
        user('add x'),
        tool('Created "x".'),
        reply('Added it.'),
        user('what next?'),
        reply('How about booking a dentist?'),
      ],
    })
    // The newest turn produced no tool, so the reply — not the earlier success — is shown.
    expect(s.tone).toBe('idle')
    expect(s.text).toMatch(/dentist/i)
  })
})

describe('toolVerb', () => {
  it('pulls a lowercase leading verb from a tool summary', () => {
    expect(toolVerb('Created "x".')).toBe('created')
    expect(toolVerb('Moved to the trash "y".')).toBe('moved')
  })
})
