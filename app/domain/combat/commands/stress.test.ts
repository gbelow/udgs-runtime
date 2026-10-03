import { describe, it, expect } from 'vitest'
import { oweStress } from './stress'
import { endTurn, surge } from './turn'
import { CombatStateSchema, type CombatState, type MoraleRoll } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { getEndTurnBar, getStartTurnBar } from '../rules/turn'
import { getDefenderSteps } from '../rules/protect'
import { makeAction } from '../factories'

function fighter(id: string, overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return { ...base, ...overrides, id, resources: { ...base.resources, AP: 8, STA: 10 } }
}

function missed(score: number, DL: number): MoraleRoll {
  return { mode: 'normal', die: 1, skill: 0, score, DL, degree: 'miss', limitStress: true }
}

// Every test of the round made, each a miss, `margins` short of its DL.
function tested(characters: CampaignCharacter[], margins: number[]): CombatState {
  return {
    ...CombatStateSchema.parse({}),
    characters: Object.fromEntries(characters.map((c) => [c.id, c])),
    morale: characters.map((c, i) => ({ id: c.id, roll: missed(10 - margins[i], 10) })),
  }
}

// The table's rulings for creating.tex "Limit Stress Actions".
describe('limit stress turns', () => {
  it('are taken before anyone else’s, the worst morale test first', () => {
    const state = oweStress(tested([fighter('a', { limitStress: 'coward' }), fighter('b', { limitStress: 'coward' }), fighter('c', { limitStress: 'coward' })], [1, 5, 3]))

    expect(state.stress.map((t) => t.id)).toEqual(['b', 'c', 'a'])
    expect(state.inTurnCharacter).toBe('b')
    expect(getStartTurnBar(state, 'a')).not.toBeNull()
  })

  it('compel a violent character’s combat surge even while they are afraid, and pass the turn on once it is made', () => {
    const afraid = fighter('b', { limitStress: 'violent', afflictions: ['afraid'] })
    const owing = oweStress(tested([fighter('a', { limitStress: 'coward' }), afraid], [1, 5]))

    expect(owing.inTurnCharacter).toBe('b')
    expect(getEndTurnBar(owing)).not.toBeNull()
    expect(endTurn(owing)).toBe(owing)

    const surged = surge('b', 'combat')(owing)
    expect(surged.characters.b.usedSurge).toBe('combat')
    expect(getEndTurnBar(surged)).toBeNull()
    expect(endTurn(surged).inTurnCharacter).toBe('a')
  })

  it('make an enraged martyr violent', () => {
    const state = oweStress(tested([fighter('a', { limitStress: 'martyr', afflictions: ['enraged'] })], [1]))

    expect(state.stress.map((t) => t.action)).toEqual(['violent'])
  })

  it('make a martyr’s reaction surge at once, with no turn to take', () => {
    const state = oweStress(tested([fighter('a', { limitStress: 'martyr' })], [1]))

    expect(state.characters.a.usedSurge).toBe('reaction')
    expect(state.inTurnCharacter).toBe('')
  })

  it('give a martyr who cannot pay for the surge a turn to rest first', () => {
    const base = fighter('a', { limitStress: 'martyr' })
    const state = oweStress(tested([{ ...base, resources: { ...base.resources, STA: 2 } }], [1]))

    expect(state.inTurnCharacter).toBe('a')
    expect(state.characters.a.usedSurge).toBeNull()
  })

  // abilities.json "Guardian": the protection surge "allows running to
  // reposition immediately to assist the ally".
  it('let a martyr holding the surge run onto the protect line, which no one else can reach', () => {
    const strike = makeAction('strike', { id: 's', actorId: 'x', targetId: 't' })
    const board = { placements: { x: { cell: { q: 0, r: 0 } }, t: { cell: { q: 6, r: 0 } }, a: { cell: { q: 3, r: 3 } } } }
    const owed = oweStress({ ...tested([fighter('a', { limitStress: 'martyr' })], [1]), board: CombatStateSchema.parse({ board }).board })
    const before = { ...owed, characters: { ...owed.characters, a: { ...owed.characters.a, usedSurge: null } } }

    expect(getDefenderSteps(owed, strike, 'a').length).toBeGreaterThan(0)
    expect(getDefenderSteps(before, strike, 'a')).toEqual([])
  })
})
