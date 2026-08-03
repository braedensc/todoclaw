import { describe, expect, it } from 'vitest'
import { classifyPendingReply } from './pending-reply'

describe('classifyPendingReply', () => {
  it('confirms a plain whole-string yes (no follow-up)', () => {
    for (const yes of [
      'yes',
      'y',
      'yeah',
      'sure',
      'ok',
      'okay',
      'do it',
      'go ahead',
      'sure thing',
    ]) {
      expect(classifyPendingReply(yes)).toEqual({ verdict: 'confirm' })
    }
    // Punctuation and casing don't matter.
    expect(classifyPendingReply('Yes!')).toEqual({ verdict: 'confirm' })
    expect(classifyPendingReply('  ok.  ')).toEqual({ verdict: 'confirm' })
  })

  it('confirms a LEADING yes with a trailing clause, carrying the whole reply as a follow-up', () => {
    // The reported papercut: this used to fall to deny() and flash a red "Declined." chip.
    expect(classifyPendingReply('yes, complete it and add milk')).toEqual({
      verdict: 'confirm',
      followUp: 'yes, complete it and add milk',
    })
    expect(classifyPendingReply('yeah do it and also water the plants')).toEqual({
      verdict: 'confirm',
      followUp: 'yeah do it and also water the plants',
    })
    expect(classifyPendingReply('sure, and book the flights')).toEqual({
      verdict: 'confirm',
      followUp: 'sure, and book the flights',
    })
  })

  it('declines a clear no or a substantively different instruction', () => {
    for (const no of ['no', 'nope', 'nah', 'cancel', 'stop']) {
      expect(classifyPendingReply(no)).toEqual({ verdict: 'deny' })
    }
    // The documented "cancel and re-instruct" case stays a decline (the caller passes the words on).
    expect(classifyPendingReply('actually make it due Friday')).toEqual({ verdict: 'deny' })
  })

  it('biases SAFE: a leading yes that turns negative is a decline, not a confirm', () => {
    // "ok no thanks" / "yes actually cancel that" must NOT auto-run the destructive tool.
    expect(classifyPendingReply('ok no thanks')).toEqual({ verdict: 'deny' })
    expect(classifyPendingReply('yes, actually cancel that')).toEqual({ verdict: 'deny' })
  })

  it('does not treat a word that merely starts with an affirmative as a yes', () => {
    // "yesterday" isn't "yes"; an empty reply isn't a confirm.
    expect(classifyPendingReply('yesterday I already did it')).toEqual({ verdict: 'deny' })
    expect(classifyPendingReply('')).toEqual({ verdict: 'deny' })
  })
})
