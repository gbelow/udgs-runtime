import { describe, it, expect } from 'vitest'
import { nextRound } from './nextRound'
import { resetCombat } from './resetCombat'
import { startTurn } from './startTurn'
import { CombatStateSchema, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'

function fighter(id: string, overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return {
    ...base,
    ...overrides,
    id,
    resources: { ...base.resources, ...(overrides.resources ?? {}) },
  }
}

function combat(characters: CampaignCharacter[], overrides: Partial<CombatState> = {}): CombatState {
  return {
    ...CombatStateSchema.parse({}),
    characters: Object.fromEntries(characters.map((c) => [c.id, c])),
    ...overrides,
  }
}

// Combat commands are pure updaters: (state) => state. They take the domain's
// CombatState, never the Zustand store, so they are testable without React.
describe('combat command purity', () => {
  it('nextRound does not mutate the input state', () => {
    const state = combat([fighter('a', { resources: { AP: 2, STA: 0, hunger: 0, thirst: 0, exhaustion: 0 } })])
    const round = state.round
    const ap = state.characters.a.resources.AP
    const surge = state.characters.a.hasActionSurge

    nextRound(state)

    expect(state.round).toBe(round)
    expect(state.characters.a.resources.AP).toBe(ap)
    expect(state.characters.a.hasActionSurge).toBe(surge)
  })

  it('resetCombat does not mutate the input state', () => {
    const state = combat([fighter('a')])
    resetCombat(state)
    expect(Object.keys(state.characters)).toEqual(['a'])
  })

  it('startTurn does not mutate the input state', () => {
    const state = combat([fighter('a')], { activeCharacterId: 'a' })
    startTurn(state)
    expect(state.inTurnCharacter).toBe('')
  })
})

describe('nextRound', () => {
  it('increments the round counter', () => {
    expect(nextRound(combat([])).round).toBe(1)
    expect(nextRound(combat([], { round: 4 })).round).toBe(5)
  })

  it('grants every character an action surge', () => {
    const state = combat([fighter('a'), fighter('b', { hasActionSurge: true })])
    const next = nextRound(state)
    expect(next.characters.a.hasActionSurge).toBe(true)
    expect(next.characters.b.hasActionSurge).toBe(true)
  })

  it('adds 6 AP but never above the 6 cap', () => {
    const state = combat([
      fighter('empty', { resources: { AP: 0, STA: 0, hunger: 0, thirst: 0, exhaustion: 0 } }),
      fighter('partial', { resources: { AP: 4, STA: 0, hunger: 0, thirst: 0, exhaustion: 0 } }),
      fighter('full', { resources: { AP: 6, STA: 0, hunger: 0, thirst: 0, exhaustion: 0 } }),
    ])
    const next = nextRound(state)
    expect(next.characters.empty.resources.AP).toBe(6)
    expect(next.characters.partial.resources.AP).toBe(6)
    expect(next.characters.full.resources.AP).toBe(6)
  })

  it('leaves the rest of a character untouched', () => {
    const state = combat([fighter('a', { name: 'Bandit' })])
    const next = nextRound(state)
    expect(next.characters.a.name).toBe('Bandit')
    expect(next.characters.a.id).toBe('a')
  })
})

describe('resetCombat', () => {
  it('clears every character and zeroes the round', () => {
    const state = combat([fighter('a'), fighter('b')], { round: 7 })
    const next = resetCombat(state)
    expect(next.characters).toEqual({})
    expect(next.round).toBe(0)
  })
})

describe('startTurn', () => {
  it('marks the active character as the one in turn', () => {
    const state = combat([fighter('a'), fighter('b')], { activeCharacterId: 'b' })
    expect(startTurn(state).inTurnCharacter).toBe('b')
  })

  it('clears the in-turn marker when nobody is active', () => {
    const state = combat([fighter('a')], { activeCharacterId: null, inTurnCharacter: 'a' })
    expect(startTurn(state).inTurnCharacter).toBe('')
  })

  it('clears the in-turn marker when the active id is dangling', () => {
    const state = combat([fighter('a')], { activeCharacterId: 'gone' })
    expect(startTurn(state).inTurnCharacter).toBe('')
  })
})
