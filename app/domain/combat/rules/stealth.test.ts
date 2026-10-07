import { describe, it, expect } from 'vitest'
import { CombatStateSchema, PlacementSchema, TerrainCellSchema, type CombatState, type Coord } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { amendAction, commitAction, declareAction, setTarget } from '../commands/action'
import { beginTurn } from '../commands/sequence'
import { nextRound } from '../commands/nextRound'
import { getTargetIds } from './action'
import { getOpenAction } from './log'
import { getTriggersFor } from './reactions'
import { getStealthScore, getStealthTurn } from './stealth'

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP: 30, STA: 10 } }
}

function fight(o: Coord, t: Coord, terrain: Record<string, unknown> = {}): CombatState {
  return {
    ...CombatStateSchema.parse({ board: { placements: { o: PlacementSchema.parse({ cell: o }), t: PlacementSchema.parse({ cell: t }) }, terrain } }),
    characters: { o: fighter('o'), t: fighter('t') },
    inTurnCharacter: 'o',
  }
}

const hiddenWith = (state: CombatState, score: number): CombatState => ({
  ...state,
  heldTests: [{ id: 't', kind: 'stealth', roll: { mode: 'normal', die: 1, skill: 0, score, skillTerms: [] } }],
})

const dim = (cell: string) => ({ [cell]: TerrainCellSchema.parse({ visibility: 'bad' }) })
const fog = (cell: string) => ({ [cell]: TerrainCellSchema.parse({ visibility: 'zero' }) })

let n = 0
const newId = () => `a${++n}`

// combat.tex "Stealth in combat": "The stealth value is rolled for each
// character individually ... Only one test per round is made" — rolled as
// the round begins (the table's ruling).
describe('the round', () => {
  it('begins with a stealth score for every character', () => {
    const begun = nextRound(() => 5, newId)(fight({ q: 0, r: 0 }, { q: 1, r: 0 }))
    expect(['o', 't'].map((id) => getStealthScore(begun, id) !== null)).toEqual([true, true])
  })
})

// combat.tex "Active senses in combat": "any character that is not in their
// turn and is detectable by an unimpaired available active sense is
// automatically detected"; "Sensory impairment": "Partial impairment means
// that active senses require a detection test against the stealth value".
describe('aiming at a character outside their turn', () => {
  const aimable = (state: CombatState) => {
    const declared = declareAction('o', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(state)
    return getTargetIds(declared, getOpenAction(declared)!)
  }

  it('needs no test against one in plain sight, however good their stealth', () => {
    expect(aimable(hiddenWith(fight({ q: 0, r: 0 }, { q: 1, r: 0 }), 1000))).toEqual(['t'])
  })

  it('needs a detection test against one only partly seen', () => {
    const partly = fight({ q: 0, r: 0 }, { q: 1, r: 0 }, dim('1,0'))
    expect(aimable(hiddenWith(partly, 1000))).toEqual([])
    expect(aimable(hiddenWith(partly, -1000))).toEqual(['t'])
  })
})

// combat.tex "Actions in stealth": "A character can only use the stealth
// value during its turn if it started undetected to the active senses of
// their reactors. The stealthy character cannot be reacted against, unless
// their stealth value grazes or misses against the reactor's detection."
describe('an attack in the attacker\'s own turn', () => {
  const struckFrom = (terrain: Record<string, unknown>, score: number) => {
    const state = beginTurn(hiddenWith(fight({ q: 1, r: 0 }, { q: 0, r: 0 }, terrain), score), 't')
    const declared = setTarget('o')(declareAction('t', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(state))
    return getTriggersFor(declared, getOpenAction(declared)!, 'o')
  }

  it('cannot be answered by one they began the turn hidden from, while their stealth holds', () => {
    expect(struckFrom(fog('0,0'), 1000)).toEqual([])
  })

  it('can be answered by one they began the turn hidden from, once their stealth fails', () => {
    expect(struckFrom(fog('0,0'), -1000).length).toBeGreaterThan(0)
  })

  it('can always be answered by one who detected them as the turn began', () => {
    expect(struckFrom({}, 1000).length).toBeGreaterThan(0)
  })
})

// combat.tex "Actions in stealth": "Careful movement and crawling add no
// penalty. All the other actions add -1 per AP spent" — the AP the turn
// counts against the stealth value are the AP its noisy actions were paid.
describe('a turn\'s noise', () => {
  const walked = (movement: 'careful' | 'basic') => {
    const state = beginTurn(hiddenWith(fight({ q: 10, r: 0 }, { q: 0, r: 0 }), 100), 't')
    const moved = commitAction(() => 5, newId)(amendAction({ movement, path: [{ q: 1, r: 0 }] })(declareAction('t', { kind: 'move' }, newId)(state)))
    const move = moved.record.find((a) => a.kind === 'move')
    expect(move, `a ${movement} step landed`).toBeDefined()
    return { counted: getStealthTurn(moved)?.AP, paid: move?.cost?.AP }
  }

  it('counts nothing for careful movement', () => {
    expect(walked('careful').counted).toBe(0)
  })

  it('counts every AP paid for any other action', () => {
    const { counted, paid } = walked('basic')
    expect(counted).toBe(paid)
  })
})
