import { describe, it, expect } from 'vitest'
import { previewText } from './chat-preview'

const assistant = (...blocks: unknown[]) => ({
  last_role: 'assistant' as const,
  last_content: blocks,
  last_meta: null,
})

describe('previewText', () => {
  it("shows BabyClaw's words unprefixed", () => {
    expect(previewText(assistant({ type: 'text', text: 'Moved that to tomorrow.' }))).toBe(
      'Moved that to tomorrow.',
    )
  })

  it('strips the machine-read [[status: …]] marker so it never leaks into the list', () => {
    const out = previewText(
      assistant({ type: 'text', text: 'Done — two things left.\n\n[[status: 2 tasks left]]' }),
    )
    expect(out).toBe('Done — two things left.')
    expect(out).not.toContain('[[')
  })

  it('flattens newlines so a multi-paragraph plan reads as one line', () => {
    expect(previewText(assistant({ type: 'text', text: 'Morning!\n\nFirst up:\n  - Taxes' }))).toBe(
      'Morning! First up: - Taxes',
    )
  })

  it('joins an assistant turn`s text blocks and ignores tool_use blocks', () => {
    expect(
      previewText(
        assistant(
          { type: 'text', text: 'Adding it' },
          { type: 'tool_use', name: 'create_task', input: {} },
          { type: 'text', text: ' now.' },
        ),
      ),
    ).toBe('Adding it now.')
  })

  it('prefixes your own words with "You:"', () => {
    expect(
      previewText({ last_role: 'user', last_content: 'move taxes to friday', last_meta: null }),
    ).toBe('You: move taxes to friday')
  })

  it('prefers meta.display so a seed-wrapped turn previews the bare words typed', () => {
    expect(
      previewText({
        last_role: 'user',
        last_content: '<context>…lots of grid state…</context>\n\nmove taxes',
        last_meta: { display: 'move taxes' },
      }),
    ).toBe('You: move taxes')
  })

  it('previews the last tool line for a tool_result turn (what the transcript shows last)', () => {
    expect(
      previewText({
        last_role: 'user',
        last_content: [{ type: 'tool_result', tool_use_id: 't1' }],
        last_meta: {
          tools: [
            { text: 'Added "Taxes"', ok: true },
            { text: 'Moved "Taxes" to Friday', ok: true },
          ],
        },
      }),
    ).toBe('Moved "Taxes" to Friday')
  })

  it('clamps a long snippet instead of putting the whole plan in the DOM', () => {
    const out = previewText(assistant({ type: 'text', text: 'x'.repeat(500) }))
    expect(out.length).toBeLessThanOrEqual(161)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns empty for a turn with nothing user-visible (tool_use-only assistant turn)', () => {
    expect(previewText(assistant({ type: 'tool_use', name: 'create_task', input: {} }))).toBe('')
  })

  it('never throws on a malformed stored row', () => {
    expect(previewText({ last_role: 'assistant', last_content: null, last_meta: null })).toBe('')
    expect(previewText({ last_role: 'user', last_content: { odd: true }, last_meta: null })).toBe(
      '',
    )
  })
})
