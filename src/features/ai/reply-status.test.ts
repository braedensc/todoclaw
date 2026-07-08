import { describe, expect, it } from 'vitest'
import { splitReply } from './reply-status'

describe('splitReply', () => {
  it('passes a plain reply through with no status', () => {
    expect(splitReply('Added it to Do Now.')).toEqual({
      body: 'Added it to Do Now.',
      status: null,
    })
  })

  it('extracts the trailing [[status: …]] line and strips it from the body', () => {
    expect(
      splitReply('Added it to Do Now — due tomorrow!\n[[status: Added "call mom" 🐾]]'),
    ).toEqual({ body: 'Added it to Do Now — due tomorrow!', status: 'Added "call mom" 🐾' })
  })

  it('is forgiving about the status: prefix and casing', () => {
    expect(splitReply('Done!\n[[Added it]]').status).toBe('Added it')
    expect(splitReply('Done!\n[[STATUS: Added it]]').status).toBe('Added it')
  })

  it('only strips a marker at the END of the reply', () => {
    const mid = 'A [[weird]] mention mid-sentence stays.'
    expect(splitReply(mid)).toEqual({ body: mid, status: null })
  })

  it('hides a mid-stream marker that opened but has not closed yet', () => {
    expect(splitReply('Added it!\n[[status: Add')).toEqual({ body: 'Added it!', status: null })
  })

  it('treats a status-only reply as empty body + status', () => {
    expect(splitReply('[[status: Need a due date!]]')).toEqual({
      body: '',
      status: 'Need a due date!',
    })
  })

  it('returns null status for an empty marker', () => {
    expect(splitReply('Done. [[status: ]]')).toEqual({ body: 'Done.', status: null })
  })
})
