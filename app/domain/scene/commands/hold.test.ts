import { describe, it, expect } from 'vitest'
import { ActionSchema, type SceneState } from '../types'
import type { CampaignCharacter } from '../../types'
import { board, medic, spearman } from '../../bot/fixtures'
import { getAvailableActions } from '../rules/options'
import { getHeldActions, getHeldOf } from '../rules/hold'
import { getOpenAction } from '../rules/log'
import { getFreeAttackOptions } from '../rules/attack'
import { commitAction, declareAction, declareReaction, rollAction, setTarget } from './action'
import { passRound } from '../../bot/table'
import { breakHeld, finishHeld } from './hold'
import { ROUND_AP } from '../../tables'

let n = 0
const newId = () => `h${++n}`
const HIT = 9
const MISS = 1

// A medic with the focus surge made and `AP` left, bleeding (the fixture's
// own bleed is what First Aid tends).
function leftWith(c: CampaignCharacter, AP: number): CampaignCharacter {
  return { ...c, usedSurge: 'focus', resources: { ...c.resources, AP, STA: 6 } }
}

function inTurn(state: SceneState, id: string): SceneState {
  return { ...state, inTurnCharacter: id }
}

// First Aid on themselves, committed with whatever AP is left.
function tendSelf(state: SceneState, id: string): SceneState {
  const declared = declareAction(id, { kind: 'firstAid' }, newId)(inTurn(state, id))
  return commitAction(() => HIT, newId)(setTarget(id)(declared))
}

function medicHolding(AP: number, enemyAt: [number, number] = [4, 0]): SceneState {
  return tendSelf(board({ m: [0, 0], e: enemyAt }, leftWith(medic('m'), AP), spearman('e')), 'm')
}

// The enemy closes in on the medic once the hold is made.
function withEnemyNext(state: SceneState): SceneState {
  return { ...state, board: state.board && { ...state.board, placements: { ...state.board.placements, e: { ...state.board.placements.e, cell: { q: 1, r: 0 } } } } }
}

// The enemy's thrust at the medic, committed and waiting on an answer.
function thrustAtMedic(held: SceneState): SceneState {
  const { weaponKey, attack, variant } = getFreeAttackOptions(held, held.characters.e, 'strike')[0]
  const struck = declareAction('e', { kind: 'strike', weaponKey, attack, variant }, newId)(inTurn(held, 'e'))
  return commitAction(() => HIT, newId)(setTarget('m')(struck))
}

const find = (state: SceneState, kind: string, actorId: string) => Object.values(state.actions).find((a) => a.kind === kind && a.actorId === actorId)

// combat.tex "Concentration": a character wants to perform an action, but
// does not have enough AP for it, and maintains concentration after their turn.
describe('an action held over to the next round', () => {
  it('takes the AP the actor has, waits off the stack, and shuts everything else', () => {
    const held = medicHolding(5)
    expect(getHeldOf(held, 'm')?.kind).toBe('firstAid')
    expect(held.characters.m.resources.AP).toBe(0)
    expect(getOpenAction(held)).toBeNull()
    expect(getAvailableActions(held, 'm').every((o) => !o.available)).toBe(true)
  })

  it('finishes before anyone acts, the two rounds paying its price between them', () => {
    const held = medicHolding(5)
    const carried = getHeldOf(held, 'm')!.carried.AP
    const round = passRound(() => HIT)(held)
    const open = getOpenAction(round)!
    expect(open.kind).toBe('firstAid')
    expect(open.step).toBe('react')
    const paid = rollAction(() => HIT, newId)(round)
    const price = find(paid, 'firstAid', 'm')!.cost!.AP
    expect(carried + price).toBe(8)
    expect(paid.characters.m.resources.AP).toBe(ROUND_AP - price)
  })

  it('is given up by its actor\'s defense, which gets the AP back less one', () => {
    const held = withEnemyNext(medicHolding(5))
    const carried = getHeldOf(held, 'm')!.carried.AP
    const defended = declareReaction('m', { kind: 'evade' }, newId)(thrustAtMedic(held))
    expect(getHeldOf(defended, 'm')).not.toBeNull()
    const rolled = rollAction(() => MISS, newId)(defended)
    expect(getHeldOf(rolled, 'm')).toBeNull()
    expect(rolled.characters.m.resources.AP).toBe(Math.max(0, carried - 1) - find(rolled, 'evade', 'm')!.cost!.AP)
  })

  // combat.tex "Opportunity Attack": "any actions that require concentration"
  // trigger one, before the effect; held over, it is as it is declared
  it('draws its opportunity attacks as it is declared, and none when it finishes', () => {
    const declared = medicHolding(5, [1, 0])
    expect(getHeldOf(declared, 'm')).toBeNull()
    expect(getAvailableActions(declared, 'e').some((o) => o.draft.kind === 'opportunityAttack' && o.available)).toBe(true)
    const round = passRound(() => HIT)(withEnemyNext(medicHolding(5)))
    expect(getOpenAction(round)?.kind).toBe('firstAid')
    expect(getAvailableActions(round, 'e').some((o) => o.draft.kind === 'opportunityAttack')).toBe(false)
  })

  it('fails when what it needs is gone by the time it finishes, and spends none of the new round', () => {
    const held = medicHolding(5)
    const healed = { ...held, characters: { ...held.characters, m: { ...held.characters.m, injuries: { ...held.characters.m.injuries, bleed: 0 } } } }
    const round = passRound(() => HIT)(healed)
    expect(getOpenAction(round)).toBeNull()
    expect(getHeldOf(round, 'm')).toBeNull()
    expect(round.characters.m.resources.AP).toBe(ROUND_AP)
    expect(round.journal.some((j) => j.reason === 'failed')).toBe(true)
  })

  // combat.tex "End of the round": the AP "reset to 8 AP minus any negative AP"
  it('goes on while the new round does not cover what is left, the focus surge made again', () => {
    const held = medicHolding(5)
    const overdrawn = { ...held, characters: { ...held.characters, m: { ...held.characters.m, resources: { ...held.characters.m.resources, AP: -6 } } } }
    const once = passRound(() => HIT)(overdrawn)
    expect(getOpenAction(once)).toBeNull()
    expect(getHeldOf(once, 'm')?.carried.AP).toBeGreaterThan(5)
    expect(once.characters.m.usedSurge).toBe('focus')
    expect(once.characters.m.resources.AP).toBe(0)
    const twice = passRound(() => HIT)(once)
    expect(getOpenAction(twice)?.kind).toBe('firstAid')
  })

  // combat.tex "Interruption": "All AP and STA costs of the action or movement
  // that have already been spent are lost."
  it('comes to nothing, and gives nothing back, when an interruption lands on its actor', () => {
    const held = medicHolding(5)
    const blow = ActionSchema.parse({ id: 'blow', kind: 'strike', actorId: 'e', targetId: 'm', step: 'done', interruption: 'interrupted' })
    const broken = breakHeld(held, blow)
    expect(getHeldOf(broken, 'm')).toBeNull()
    expect(broken.characters.m.resources.AP).toBe(held.characters.m.resources.AP)
    expect(broken.journal.at(-1)?.reason).toBe('interrupted')
  })
})

// combat.tex "Concentration": "If multiple concentration actions finish in the
// next round, make cunning tests for all contenders and apply effects from
// highest to lowest."
describe('several actions finishing in the same round', () => {
  function twoMedics(): SceneState {
    const start = board({ a: [0, 0], b: [3, 0], e: [8, 0] }, leftWith(medic('a'), 5), leftWith(medic('b'), 5), spearman('e'))
    return tendSelf(tendSelf(start, 'a'), 'b')
  }
  const fresh = (state: SceneState): SceneState => ({ ...state, characters: Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, { ...c, usedSurge: null, resources: { ...c.resources, AP: ROUND_AP } }])) })

  it.each([[[9, 2], 'a'], [[2, 9], 'b']] as const)('puts the higher cunning roll first (%j)', (faces, first) => {
    const held = twoMedics()
    let thrown = 0
    const dice = () => faces[thrown++ % faces.length]
    const finishing = finishHeld(fresh(held), getHeldActions(held).map((h) => h.id), dice)
    expect(getOpenAction(finishing)?.actorId).toBe(first)
  })
})
