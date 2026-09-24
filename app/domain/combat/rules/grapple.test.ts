import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { DEGREES, type CampaignCharacter } from '../../types'
import { MOVEMENT_KINDS } from '../../lists'
import { getAvailableActions, getOpenAction, getRootTest } from './action'
import { getMovementOptions } from './move'
import { commitAction, declareAction, resolveAction, rollAction, setTarget } from '../commands/action'

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, fightName: id, resources: { ...base.resources, AP: 20, STA: 20 } }
}

let n = 0
const newId = () => `a${++n}`

// Two unarmed fighters side by side, the first having grabbed the second
// with a free hand — held both ways, since a free hand grapples back.
function grappling(): CombatState {
  let s: CombatState = {
    ...CombatStateSchema.parse({ board: { placements: { a: { cell: { q: 0, r: 0 } }, b: { cell: { q: 1, r: 0 } } } } }),
    characters: { a: fighter('a'), b: fighter('b') },
  }
  s = declareAction('a', { kind: 'strike', grab: true, weaponKey: 'natural:Unarmed', attack: 'grapple', variant: 'basic' }, newId)(s)
  s = commitAction()(setTarget('b')(s))
  return resolveAction(newId)(rollAction(() => 50)(s))
}

// The open action's test thrown to come out over its DL by exactly `over`.
function rollOver(s: CombatState, over: number): CombatState {
  const test = getRootTest(s, getOpenAction(s)!)!
  return rollAction(() => test.DL - test.skill + over)(s)
}

const OVER = { critical: 10, hit: 5, graze: 0, miss: -1 } as const

describe('grapple', () => {
  // combat.tex "Grapple": "When a character is under the effect of grapple,
  // it cannot move without dragging the other grappler."
  it.each(['a', 'b'])('closes every movement to %s while in the grapple', (id) => {
    const s = grappling()
    const moves = getMovementOptions(s, s.characters[id])
    for (const kind of MOVEMENT_KINDS) expect(moves.find((m) => m.kind === kind)?.available).toBe(false)
  })

  // combat.tex "Immobile": "Cannot move and cannot use any combat or
  // movement skills other than escape."
  it('leaves an immobile character nothing to declare but an escape', () => {
    let s = grappling()
    s = declareAction('a', { kind: 'grapple', maneuver: 'immobilize' }, newId)(s)
    s = resolveAction(newId)(rollOver(commitAction()(setTarget('b')(s)), OVER.critical))
    const open = getAvailableActions(s, 'b').filter((o) => o.available)
    expect(open.map((o) => o.draft)).toEqual([{ kind: 'grapple', maneuver: 'escape' }])
  })

  // combat.tex "Escape": "Escapes from the grapple on criticals and hits."
  it.each(DEGREES)('an escape at %s ends the grapple only on a critical or a hit', (degree) => {
    let s = grappling()
    s = declareAction('b', { kind: 'grapple', maneuver: 'escape' }, newId)(s)
    s = resolveAction(newId)(rollOver(commitAction()(setTarget('a')(s)), OVER[degree]))
    expect(s.grapples.length === 0).toBe(degree === 'critical' || degree === 'hit')
  })
})
