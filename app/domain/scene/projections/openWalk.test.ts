import { describe, expect, it } from 'vitest'
import { getShownReactor, hasOwnToReact, type AnswerWalk, type ReactorStatus, type WalkStep } from './openWalk'

// The user's ruling (2026-11-27) on many reactors: the reactions show one
// reactor at a time, the viewer's own the action waits on first, and move on
// to the next of them once one is done; they are put away to a button while
// none of the viewer's own are waited on.

const STEP: WalkStep = { key: 'answer', label: 'reaction', kind: 'pick', buttons: [], now: null, keep: false }

const reactor = (id: string, status: ReactorStatus, walked = status === 'passed' || status === 'done'): AnswerWalk =>
  ({ id, name: id, target: false, status, answer: null, cancellable: null, done: null, walk: id, step: walked ? null : STEP, back: null })

describe('the reactor the reactions show', () => {
  it('is the first of the viewer’s own the action waits on, not anyone else’s', () => {
    const all = [reactor('foe', 'waiting'), reactor('a', 'done'), reactor('b', 'waiting'), reactor('c', 'waiting')]
    expect(getShownReactor(all, ['a', 'b', 'c'], null)).toBe('b')
  })

  it('moves on to the next of the viewer’s own once the one picked is done', () => {
    const before = [reactor('b', 'reacting'), reactor('c', 'waiting')]
    expect(getShownReactor(before, ['b', 'c'], { id: 'b', review: false })).toBe('b')
    const after = [reactor('b', 'done'), reactor('c', 'waiting')]
    expect(getShownReactor(after, ['b', 'c'], { id: 'b', review: false })).toBe('c')
  })

  it('stays on one done while their walk still has a step left', () => {
    const all = [reactor('b', 'done', false), reactor('c', 'waiting')]
    expect(getShownReactor(all, ['b', 'c'], { id: 'b', review: false })).toBe('b')
  })

  it('keeps a finished one picked to be looked at again', () => {
    const all = [reactor('b', 'done'), reactor('c', 'waiting')]
    expect(getShownReactor(all, ['b', 'c'], { id: 'b', review: true })).toBe('b')
  })
})

describe('whether the reactions open shown whole', () => {
  it('is so while one of the viewer’s own is waited on, and not otherwise', () => {
    expect(hasOwnToReact([reactor('foe', 'waiting'), reactor('a', 'waiting')], ['a'])).toBe(true)
    expect(hasOwnToReact([reactor('foe', 'waiting'), reactor('a', 'done')], ['a'])).toBe(false)
    expect(hasOwnToReact([reactor('foe', 'waiting')], ['a'])).toBe(false)
  })
})
