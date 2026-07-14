import { describe, it, expect, vi } from 'vitest'
// use-chat-messages imports lib/supabase, which THROWS at import when the VITE_* env vars are unset
// (CI has none). Stub it so importing the pure mapper never touches real env (memory: import-throw).
vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { rowsToChatItems } from './use-chat-messages'
import type { ChatMessageRow } from '../../types/chat'

const row = (r: Partial<ChatMessageRow> & { seq: number; role: 'user' | 'assistant' }) =>
  ({ content: null, meta: null, ...r }) as ChatMessageRow

describe('rowsToChatItems', () => {
  it('maps a plain user turn to a user bubble', () => {
    const items = rowsToChatItems([row({ seq: 1, role: 'user', content: 'add dentist' })])
    expect(items).toEqual([{ id: 'm1', role: 'user', text: 'add dentist' }])
  })

  it('shows the bare user words (meta.display) for a seed-folded turn, not the seed-wrapped content', () => {
    const items = rowsToChatItems([
      row({
        seq: 3,
        role: 'user',
        content: '(Context — …)\n\nwhat now?',
        meta: { display: 'what now?' },
      }),
    ])
    expect(items[0]!.text).toBe('what now?')
  })

  it('skips a hidden framing turn (a proactive session’s server-seeded context primes the model only)', () => {
    const items = rowsToChatItems([
      row({
        seq: 1,
        role: 'user',
        content: 'The app just opened my morning plan for me — I may want to adjust it.',
        meta: { hidden: true },
      }),
      row({ seq: 2, role: 'assistant', content: 'Your morning plan\n\n1. Ship the deck' }),
    ])
    expect(items).toEqual([
      { id: 'm2', role: 'assistant', text: 'Your morning plan\n\n1. Ship the deck' },
    ])
  })

  it('renders an assistant turn as one bubble (text blocks joined; tool_use blocks ignored)', () => {
    const items = rowsToChatItems([
      row({
        seq: 5,
        role: 'assistant',
        content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', id: 'x', name: 'create_task', input: {} },
        ],
      }),
    ])
    expect(items).toEqual([{ id: 'm5', role: 'assistant', text: 'On it.' }])
  })

  it('emits nothing for an assistant tool_use-only turn (the lines come from the tool_result turn)', () => {
    const items = rowsToChatItems([
      row({
        seq: 6,
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'x', name: 'delete_task', input: {} }],
      }),
    ])
    expect(items).toEqual([])
  })

  it('renders per-tool display lines from a tool_result turn meta.tools', () => {
    const items = rowsToChatItems([
      row({
        seq: 7,
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'x', content: 'raw', is_error: false }],
        meta: {
          tools: [
            { text: 'Created "SCP" on the grid.', ok: true },
            { text: 'Removed "y".', ok: false },
          ],
        },
      }),
    ])
    expect(items).toEqual([
      { id: 'm7-t0', role: 'tool', text: 'Created "SCP" on the grid.', ok: true },
      { id: 'm7-t1', role: 'tool', text: 'Removed "y".', ok: false },
    ])
  })

  it('renders a deny-with-note turn as BOTH the note bubble and the Declined line (reload fidelity)', () => {
    // A typed corrective decline persists meta.display (the note) + meta.tools (Declined). On reload
    // the user's words must still show, not just "Declined." — the two are independent.
    const items = rowsToChatItems([
      row({
        seq: 12,
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'x',
            content: 'User declined this action.',
            is_error: true,
          },
          { type: 'text', text: 'no, make it Friday instead' },
        ],
        meta: {
          display: 'no, make it Friday instead',
          tools: [{ text: 'Declined.', ok: false }],
        },
      }),
    ])
    expect(items).toEqual([
      { id: 'm12', role: 'user', text: 'no, make it Friday instead' },
      { id: 'm12-t0', role: 'tool', text: 'Declined.', ok: false },
    ])
  })

  it('emits nothing for a repair/tool_result turn with no display meta', () => {
    const items = rowsToChatItems([
      row({
        seq: 8,
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'x', content: 'interrupted', is_error: true },
        ],
      }),
    ])
    expect(items).toEqual([])
  })

  it('keeps a status-only reply intact for splitReply at render (no pre-stripping here)', () => {
    // The mapper does not strip [[status:]] — the Bubble runs splitReply. So a reply that is only a
    // status line still round-trips its raw text.
    const items = rowsToChatItems([
      row({
        seq: 9,
        role: 'assistant',
        content: [{ type: 'text', text: '[[status: Added "x" 🐾]]' }],
      }),
    ])
    expect(items[0]!.text).toBe('[[status: Added "x" 🐾]]')
  })

  it('produces stable, unique ids across a mixed transcript (no dup keys)', () => {
    const items = rowsToChatItems([
      row({ seq: 1, role: 'user', content: 'hi' }),
      row({ seq: 2, role: 'assistant', content: [{ type: 'text', text: 'hello' }] }),
      row({
        seq: 3,
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'a', content: 'r', is_error: false }],
        meta: {
          tools: [
            { text: 'did a', ok: true },
            { text: 'did b', ok: true },
          ],
        },
      }),
    ])
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
