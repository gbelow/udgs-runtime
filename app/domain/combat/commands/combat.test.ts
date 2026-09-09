import { describe, it, expect } from 'vitest'
import { nextRound } from './nextRound'
import { startTurn } from './startTurn'
import { CombatStateSchema, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter, SurgeKind } from '../../types'
import { addCharacterToCombat } from './addCharacterToCombat'

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

const surges: (SurgeKind | null)[] = ['movement', 'combat', 'reaction', 'focus', null]

describe('nextRound', () => {
  // combat.tex "Action surge": one surge per round. A new round has to clear
  // the mark for every character in the fight, whichever kind they spent.
  it('clears the used surge of every character, whatever they used', () => {
    const state = combat(surges.map((usedSurge, i) => fighter(`f${i}`, { usedSurge })))
    const cleared = Object.values(nextRound(state).characters).map((c) => c.usedSurge)
    expect(cleared).toEqual(cleared.map(() => null))
  })

  // A round puts everyone on the same ceiling: a character who hoarded action
  // points — an action surge can carry them above it — starts no better off
  // than one who spent them all, and a character who spent them all is refilled.
  it('starts every character on the same ceiling, whatever they were carrying', () => {
    const starts = [0, 1, 3, 5, 6, 12]
    const state = combat(starts.map((AP, i) => fighter(`f${i}`, { resources: { AP } as CampaignCharacter['resources'] })))
    const refilled = Object.values(nextRound(state).characters).map((c) => c.resources.AP)

    expect(new Set(refilled).size).toBe(1)
    expect(refilled[0]).toBeGreaterThan(starts[0])
  })

  it('changes nothing on a character but the surge mark and the action points', () => {
    const before = fighter('a', { name: 'Bandit', usedSurge: 'focus', resources: { AP: 2 } as CampaignCharacter['resources'] })
    const after = nextRound(combat([before])).characters.a

    expect({ ...after, usedSurge: null, resources: null }).toEqual({ ...before, usedSurge: null, resources: null })
    expect({ ...after.resources, AP: 0 }).toEqual({ ...before.resources, AP: 0 })
  })
})

// The in-turn marker is read straight back as a key into `characters`, so the
// only safe values it can hold are an id that is in the fight or nothing at
// all — including when the active id was left dangling by a removal.
describe('startTurn', () => {
  const state = combat([fighter('a'), fighter('b')])

  // A character in the fight, nobody at all, an id left dangling by a removal,
  // and an empty id.
  it.each(['b', null, 'gone', ''] as const)('resolves %s to a usable marker', (activeCharacterId) => {
    const marked = startTurn({ ...state, activeCharacterId })
    expect(marked.inTurnCharacter === '' || marked.inTurnCharacter in marked.characters).toBe(true)
  })
})



// Adding the same character sheet to a fight twice replaced the first copy:
// makeCampaignCharacter carries the incoming id through, and the combat store
// keys its characters by that id, so the second add overwrote the first.
describe('addCharacterToCombat', () => {
  it('issues a duplicate copy an id the fight is not already using', () => {
    const sheet = makeCampaignCharacter({ name: 'Bob' })

    const first = addCharacterToCombat(sheet, {}, () => 'issued-1')
    const second = addCharacterToCombat(sheet, { [first.id]: first }, () => 'issued-2')

    expect(first.id).toBe(sheet.id)
    expect(second.id).toBe('issued-2')
  })
})
