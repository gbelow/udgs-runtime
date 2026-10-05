import { describe, it, expect } from 'vitest'
import { CombatStateSchema, PlacementSchema, TerrainCellSchema, type CombatState, type Coord, type Direction } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { amendAction, commitAction, declareAction, resolveAction, setTarget } from '../commands/action'
import { getTargetIds } from './action'
import { getOpenAction } from './log'
import { getHeldCalled } from './heldTest'
import { endTurn } from '../commands/turn'
import { getTriggersFor } from './reactions'
import { getNotice, getStealthValue } from './stealth'

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP: 30, STA: 10 } }
}

type Stand = { cell: Coord; orientation: Direction }

function fight(o: Stand, t: Stand, terrain: Record<string, unknown> = {}): CombatState {
  return {
    ...CombatStateSchema.parse({ board: { placements: { o: PlacementSchema.parse(o), t: PlacementSchema.parse(t) }, terrain } }),
    characters: { o: fighter('o'), t: fighter('t') },
    inTurnCharacter: 'o',
  }
}

const hiddenWith = (state: CombatState, score: number): CombatState => ({
  ...state,
  heldTests: [{ id: 't', kind: 'stealth', roll: { mode: 'normal', die: 1, skill: 0, score, skillTerms: [] } }],
})

const calledToStealth = (state: CombatState) => getHeldCalled(state).filter((t) => t.kind === 'stealth').map((t) => t.id).sort()

let n = 0
const newId = () => `a${++n}`

// combat.tex "Stealth in combat": the test is made "for each character in
// stealth ... only ... for characters that started their round undetectable to
// any opponent active senses."
describe('the round calls a stealth test', () => {
  const east: Direction = 0
  const west: Direction = 3

  it('of whoever no opponent sees', () => {
    expect(calledToStealth(fight({ cell: { q: 0, r: 0 }, orientation: east }, { cell: { q: -2, r: 0 }, orientation: west }))).toEqual(['o', 't'])
  })

  it('of nobody who is in sight', () => {
    expect(calledToStealth(fight({ cell: { q: 0, r: 0 }, orientation: east }, { cell: { q: 2, r: 0 }, orientation: west }))).toEqual([])
  })

  it('of whoever stands behind a wall', () => {
    const wall = { '1,0': TerrainCellSchema.parse({ blocking: true }) }
    expect(calledToStealth(fight({ cell: { q: 0, r: 0 }, orientation: east }, { cell: { q: 2, r: 0 }, orientation: west }, wall))).toEqual(['o', 't'])
  })

  it('of nobody in a fight without a board', () => {
    expect(calledToStealth({ ...fight({ cell: { q: 0, r: 0 }, orientation: east }, { cell: { q: -2, r: 0 }, orientation: west }), board: null })).toEqual([])
  })
})

// combat.tex "Stealth in combat": "Enemies cannot target the character unless
// their detection is higher than the stealth value".
describe('a character in stealth', () => {
  const adjacent = fight({ cell: { q: 0, r: 0 }, orientation: 0 }, { cell: { q: 1, r: 0 }, orientation: 3 })
  const aimable = (state: CombatState) => {
    const declared = declareAction('o', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(state)
    return getTargetIds(declared, getOpenAction(declared)!)
  }

  it('cannot be aimed at by someone whose detection falls short of their stealth', () => {
    expect(aimable(hiddenWith(adjacent, 1000))).toEqual([])
  })

  it('can be aimed at by someone whose detection beats their stealth', () => {
    expect(aimable(hiddenWith(adjacent, -1000))).toEqual(['t'])
  })

  it('can be aimed at when there is no stealth test to hide behind', () => {
    expect(aimable(adjacent)).toEqual(['t'])
  })
})

// combat.tex "Stealth penalties": careful movement, then normal movement, then
// running and jumping, each costs more stealth than the last.
describe('a character in stealth who moves', () => {
  const valueAfter = (movement: 'careful' | 'basic' | 'run') => {
    const start = hiddenWith(fight({ cell: { q: 10, r: 0 }, orientation: 0 }, { cell: { q: 0, r: 0 }, orientation: 0 }), 100)
    const walking = amendAction({ movement, path: [{ q: 1, r: 0 }] })(declareAction('t', { kind: 'move' }, newId)({ ...start, inTurnCharacter: 't' }))
    const walked = commitAction(() => 5, newId)(walking)
    expect(walked.record.some((a) => a.kind === 'move'), `a ${movement} step landed`).toBe(true)
    return getStealthValue(walked, 't')!
  }

  it('is the harder to find the more carefully it goes', () => {
    const [careful, basic, run] = [valueAfter('careful'), valueAfter('basic'), valueAfter('run')]
    expect(careful).toBeGreaterThan(basic)
    expect(basic).toBeGreaterThan(run)
  })
})

// combat.tex "Stealth in combat": "Enemies ... cannot react to them if their
// detection is not 4 points lower, at most (a graze in stealth)."
describe('an attack from stealth', () => {
  const struck = () => {
    const state = hiddenWith(fight({ cell: { q: 1, r: 0 }, orientation: 0 }, { cell: { q: 0, r: 0 }, orientation: 0 }), 1000)
    const declared = declareAction('t', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)({ ...state, inTurnCharacter: 't' })
    return { state, declared: setTarget('o')(declared) }
  }

  it('cannot be answered by someone who has not noticed it', () => {
    const { declared } = struck()
    expect(getTriggersFor(declared, getOpenAction(declared)!, 'o')).toEqual([])
  })

  it('can be answered once the attacker is not hidden', () => {
    const { declared } = struck()
    const open = { ...declared, heldTests: [] }
    expect(getTriggersFor(open, getOpenAction(open)!, 'o').length).toBeGreaterThan(0)
  })

  // combat.tex "Attacking from stealth": "Being attacked automatically causes
  // detection through touch after the attack".
  it('leaves the one struck able to react to the attacker, but not to target them', () => {
    const { declared } = struck()
    const landed = resolveAction(newId)(commitAction(() => 5, newId)(declared))
    expect(landed.record.some((a) => a.kind === 'strike')).toBe(true)
    expect(getNotice(landed, 'o', 't')).toBe('sensed')
  })
})

// combat.tex "Stealth in combat", "Staying in stealth".
describe('a character in stealth at the end of their turn', () => {
  const east: Direction = 0
  const west: Direction = 3
  const endedBy = (state: CombatState) => endTurn({ ...hiddenWith(state, 100), inTurnCharacter: 't' })

  it('stays in stealth when no opponent can see them', () => {
    const wall = { '1,0': TerrainCellSchema.parse({ blocking: true }) }
    expect(getStealthValue(endedBy(fight({ cell: { q: 0, r: 0 }, orientation: east }, { cell: { q: 2, r: 0 }, orientation: west }, wall)), 't')).not.toBeNull()
  })

  it('is detected by everyone once an opponent can see them', () => {
    expect(getStealthValue(endedBy(fight({ cell: { q: 0, r: 0 }, orientation: east }, { cell: { q: 2, r: 0 }, orientation: west })), 't')).toBeNull()
  })
})
