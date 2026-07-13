import { describe, expect, it } from 'vitest'
import { endsWithQuestion, splitReply } from './reply-status'

describe('splitReply', () => {
  it('passes a plain reply through with no status', () => {
    expect(splitReply('Added it to Do Now.')).toEqual({
      body: 'Added it to Do Now.',
      status: null,
      needsInput: false,
    })
  })

  it('extracts the trailing [[status: …]] line and strips it from the body', () => {
    expect(
      splitReply('Added it to Do Now — due tomorrow!\n[[status: Added "call mom" 🐾]]'),
    ).toEqual({
      body: 'Added it to Do Now — due tomorrow!',
      status: 'Added "call mom" 🐾',
      needsInput: false,
    })
  })

  it('is forgiving about the status: prefix and casing', () => {
    expect(splitReply('Done!\n[[Added it]]').status).toBe('Added it')
    expect(splitReply('Done!\n[[STATUS: Added it]]').status).toBe('Added it')
  })

  it('only strips a marker at the END of the reply', () => {
    const mid = 'A [[weird]] mention mid-sentence stays.'
    expect(splitReply(mid)).toEqual({ body: mid, status: null, needsInput: false })
  })

  it('strips a trailing status even when its text contains a ] (e.g. a bracketed task name)', () => {
    // Regression: the capture used to exclude `]`, so a `]` inside the status (a task named
    // "read [ch 3]") defeated the strip and leaked the raw [[status: …]] marker into the bubble.
    expect(splitReply('Renamed it!\n[[status: Renamed to "read [ch 3]" 🐾]]')).toEqual({
      body: 'Renamed it!',
      status: 'Renamed to "read [ch 3]" 🐾',
      needsInput: false,
    })
  })

  it('hides a mid-stream marker that opened but has not closed yet', () => {
    expect(splitReply('Added it!\n[[status: Add')).toEqual({
      body: 'Added it!',
      status: null,
      needsInput: false,
    })
  })

  it('treats a status-only reply as empty body + status', () => {
    expect(splitReply('[[status: Need a due date!]]')).toEqual({
      body: '',
      status: 'Need a due date!',
      needsInput: false,
    })
  })

  it('returns null status for an empty marker', () => {
    expect(splitReply('Done. [[status: ]]')).toEqual({
      body: 'Done.',
      status: null,
      needsInput: false,
    })
  })

  // ---- the waiting-on-you signal ---------------------------------------------------------
  it('strips the "? " waiting marker from the status and flags needsInput', () => {
    expect(splitReply('When is it due?\n[[status: ? Need a due date for that one]]')).toEqual({
      body: 'When is it due?',
      status: 'Need a due date for that one',
      needsInput: true,
    })
  })

  it('flags a status that itself ends on a question, even without the marker', () => {
    expect(splitReply('Hmm.\n[[status: Which task did you mean?]]').needsInput).toBe(true)
  })

  it('flags a reply whose body plainly ends on a question (older/forgetful replies)', () => {
    expect(splitReply('Sure — when is it due?').needsInput).toBe(true)
    expect(splitReply('Sure — when is it due? 🐾').needsInput).toBe(true)
    expect(splitReply('Want me to place it too?\n[[status: Added "x" 🐾]]').needsInput).toBe(true)
  })

  it('does not flag plain statements', () => {
    expect(splitReply('Added it — nice one! 🐾').needsInput).toBe(false)
  })
})

describe('endsWithQuestion', () => {
  it('sees through trailing sign-off decoration', () => {
    expect(endsWithQuestion('Which one?')).toBe(true)
    expect(endsWithQuestion('Which one? 🐾')).toBe(true)
    expect(endsWithQuestion('Really?!')).toBe(true)
    expect(endsWithQuestion('“Which one?”')).toBe(true)
  })

  it('rejects statements', () => {
    expect(endsWithQuestion('Added it.')).toBe(false)
    expect(endsWithQuestion('Need a due date!')).toBe(false)
    expect(endsWithQuestion('')).toBe(false)
  })
})
