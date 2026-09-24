import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type CombatState, type MoveAction } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { DEGREES, ItemSchema, type CampaignCharacter } from '../../types'
import { GRAPPLE_MANEUVERS, MOVEMENT_KINDS } from '../../lists'
import { holdItem } from '../../item/commands/hands'
import { settleGrapples } from '../commands/grapple'
import { getAvailableActions, getOpenAction, getRootTest } from './action'
import { getMovementOptions, getReachableCells } from './move'
import { distance } from '../geometry'
import { skillLenses } from '../../character/lenses'
import { getForce } from '../../character/rules/skills'
import { chooseManeuver, commitAction, declareAction, resolveAction, rollAction, setTarget } from '../commands/action'

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
  // combat.tex "Grappled": "Movement requires pushing or dragging the other
  // participants in the grapple"; "Push and drag": "Moving within the
  // grapple area, without displacing the opponent, is possible if Force is
  // no lower than 5 points lower than the opponent"; "Escape is also used
  // for trying to stand up while grappled".
  it.each(['a', 'b'] as const)('lets %s move around the partner but not out of the grapple, nor stand up', (id) => {
    const s = grappling()
    const partner = s.board!.placements[id === 'a' ? 'b' : 'a'].cell
    const moves = getMovementOptions(s, s.characters[id])
    expect(moves.find((m) => m.kind === 'stand')?.available).toBe(false)
    const move = getOpenAction(declareAction(id, { kind: 'move', movement: 'basic' }, newId)(s))
    const reachable = getReachableCells(s, move as MoveAction)
    expect(reachable.length).toBeGreaterThan(0)
    for (const r of reachable) expect(distance(r.cell, partner)).toBeLessThanOrEqual(1)
  })

  it.each(['a', 'b'] as const)('closes every movement to %s when more than 5 Force below the partner', (id) => {
    const s = grappling()
    const other = id === 'a' ? 'b' : 'a'
    const strong = skillLenses.force.set(s.characters[other], getForce(s.characters[id]) + 6) as CampaignCharacter
    const weaker = { ...s, characters: { ...s.characters, [other]: strong } }
    const moves = getMovementOptions(weaker, weaker.characters[id])
    for (const kind of MOVEMENT_KINDS) expect(moves.find((m) => m.kind === kind)?.available).toBe(false)
  })

  // The table's ruling: "the grapplers must have a grapple property attack
  // in one of their weapons at all times ... failing to do so releases the
  // grapple."
  it('lets go for a holder left with no grapple row', () => {
    const s = grappling()
    const sword = () => ItemSchema.parse({ name: 'Short Sword', type: 'weapon', refId: 'Short Sword', bulk: 1 })
    const full = holdItem(sword())(holdItem(sword())(s.characters.a)) as CampaignCharacter
    const settled = settleGrapples(s.grapples)({ ...s, characters: { ...s.characters, a: full } })
    expect(settled.grapples.flatMap((g) => g.holders)).not.toContain('a')
  })

  // combat.tex "Grapple Maneuvers": "If a grapple maneuvre grazes or misses,
  // it simply as no effect."
  it.each(GRAPPLE_MANEUVERS.flatMap((m) => (['graze', 'miss'] as const).map((degree) => [m, degree] as const)))('a %s that comes to a %s changes nothing', (maneuver, degree) => {
    let s = grappling()
    s = declareAction('a', { kind: 'grapple', maneuver }, newId)(s)
    s = rollOver(commitAction()(setTarget('b')(s)), OVER[degree])
    s = chooseManeuver({ along: true, item: s.characters.b.held[0]?.id ?? '' })(s)
    const after = resolveAction(newId)(s)
    expect(after.grapples).toEqual(s.grapples)
    expect(after.floor).toEqual(s.floor)
    for (const id of ['a', 'b']) expect(after.characters[id].afflictions).toEqual(s.characters[id].afflictions)
  })

  // combat.tex "Escape": standing up that way "does not disolve the grapple".
  it.each(DEGREES)('an escape to stand up at %s leaves the grapple standing', (degree) => {
    let s = grappling()
    s = { ...s, characters: { ...s.characters, b: { ...s.characters.b, afflictions: ['prone'] } } }
    s = declareAction('b', { kind: 'grapple', maneuver: 'escape', stand: true }, newId)(s)
    s = resolveAction(newId)(rollOver(commitAction()(setTarget('a')(s)), OVER[degree]))
    expect(s.grapples).toHaveLength(1)
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
