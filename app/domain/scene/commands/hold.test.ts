import { describe, it, expect } from 'vitest'
import { ActionSchema, type SceneState } from '../types'
import type { CampaignCharacter } from '../../types'
import { archer, board, fighter, medic, passRound, spearman } from '../fixtures'
import { getAvailableActions } from '../rules/options'
import { getHeldActions, getHeldOf } from '../rules/hold'
import { getOpenAction } from '../rules/log'
import { getFreeAttackOptions } from '../rules/attack'
import { amendAction, commitAction, declareAction, declareReaction, rollAction, setTarget } from './action'
import { getOpenChoices } from '../projections/choices'
import { breakHeld, dropHeld, finishHeld, releaseHeld } from './hold'
import { makeCaller } from '../../play/calls'
import { ROUND_AP } from '../../tables'
import { ABILITIES } from '../../abilities'
import { BLEED_STOPPED } from '../../character/rules/tendWounds'

let n = 0
const newId = () => `h${++n}`
const HIT = 9
const MISS = 1
// Short of First Aid's price, so the action is held over.
const FIRST_AID_AP = ABILITIES['first-aid'].cost.AP
const SHORT = FIRST_AID_AP - 2

// A medic with the focus surge made and `AP` left.
function leftWith(c: CampaignCharacter, AP: number): CampaignCharacter {
  return { ...c, usedSurge: 'focus', resources: { ...c.resources, AP, STA: 6 } }
}

// Collapsed and bleeding, for First Aid to tend (abilities.tex "First Aid":
// "as long as the patient is collapsed"), with more bleed than their own
// tend wounds tests stop over the rounds a test passes.
function patient(id: string): CampaignCharacter {
  const c = fighter(id)
  return { ...c, injuries: { ...c.injuries, bleed: BLEED_STOPPED.critical * 3, collapsedByChoice: true } }
}

function inTurn(state: SceneState, id: string): SceneState {
  return { ...state, inTurnCharacter: id }
}

// First Aid on the patient beside them, held over with whatever AP is left.
function tend(state: SceneState, id: string, patientId: string): SceneState {
  const declared = declareAction(id, { kind: 'firstAid' }, newId)(inTurn(state, id))
  return commitAction(() => HIT, newId, true)(setTarget(patientId)(declared))
}

function medicHolding(AP: number, enemyAt: [number, number] = [4, 0]): SceneState {
  return tend(board({ m: [0, 0], p: [0, 1], e: enemyAt }, leftWith(medic('m'), AP), patient('p'), spearman('e')), 'm', 'p')
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
    const held = medicHolding(SHORT)
    expect(getHeldOf(held, 'm')?.kind).toBe('firstAid')
    expect(held.characters.m.resources.AP).toBe(0)
    expect(getOpenAction(held)).toBeNull()
    expect(getAvailableActions(held, 'm').every((o) => !o.available)).toBe(true)
  })

  it('finishes before anyone acts, the two rounds paying its price between them', () => {
    const held = medicHolding(SHORT)
    const carried = getHeldOf(held, 'm')!.carried.AP
    const round = passRound(() => HIT)(held)
    const open = getOpenAction(round)!
    expect(open.kind).toBe('firstAid')
    expect(open.step).toBe('react')
    const paid = rollAction(() => HIT, newId)(round)
    const price = find(paid, 'firstAid', 'm')!.cost!.AP
    expect(carried + price).toBe(FIRST_AID_AP)
    expect(paid.characters.m.resources.AP).toBe(ROUND_AP - price)
  })

  it('is given up by its actor\'s defense, which gets the AP back less one', () => {
    const held = withEnemyNext(medicHolding(SHORT))
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
    const declared = medicHolding(SHORT, [1, 0])
    expect(getHeldOf(declared, 'm')).toBeNull()
    expect(getAvailableActions(declared, 'e').some((o) => o.draft.kind === 'opportunityAttack' && o.available)).toBe(true)
    const round = passRound(() => HIT)(withEnemyNext(medicHolding(SHORT)))
    expect(getOpenAction(round)?.kind).toBe('firstAid')
    expect(getAvailableActions(round, 'e').some((o) => o.draft.kind === 'opportunityAttack')).toBe(false)
  })

  it('fails when what it needs is gone by the time it finishes, and spends none of the new round', () => {
    const held = medicHolding(SHORT)
    const healed = { ...held, characters: { ...held.characters, p: { ...held.characters.p, injuries: { ...held.characters.p.injuries, bleed: 0 } } } }
    const round = passRound(() => HIT)(healed)
    expect(getOpenAction(round)).toBeNull()
    expect(getHeldOf(round, 'm')).toBeNull()
    expect(round.characters.m.resources.AP).toBe(ROUND_AP)
    expect(round.journal.some((j) => j.reason === 'failed')).toBe(true)
  })

  // combat.tex "End of the round": the AP "reset to 8 AP minus any negative AP"
  it('goes on while the new round does not cover what is left, the focus surge made again', () => {
    const held = medicHolding(SHORT)
    const overdrawn = { ...held, characters: { ...held.characters, m: { ...held.characters.m, resources: { ...held.characters.m.resources, AP: FIRST_AID_AP - SHORT - 1 - ROUND_AP } } } }
    const once = passRound(() => HIT)(overdrawn)
    expect(getOpenAction(once)).toBeNull()
    expect(getHeldOf(once, 'm')?.carried.AP).toBeGreaterThan(SHORT)
    expect(once.characters.m.usedSurge).toBe('focus')
    expect(once.characters.m.resources.AP).toBe(0)
    const twice = passRound(() => HIT)(once)
    expect(getOpenAction(twice)?.kind).toBe('firstAid')
  })

  // combat.tex "Interruption": "All AP and STA costs of the action or movement
  // that have already been spent are lost."
  it('comes to nothing, and gives nothing back, when an interruption lands on its actor', () => {
    const held = medicHolding(SHORT)
    const blow = ActionSchema.parse({ id: 'blow', kind: 'strike', actorId: 'e', targetId: 'm', step: 'done', interruption: 'interrupted' })
    const broken = breakHeld(held, blow)
    expect(getHeldOf(broken, 'm')).toBeNull()
    expect(broken.characters.m.resources.AP).toBe(held.characters.m.resources.AP)
    expect(broken.journal.at(-1)?.reason).toBe('interrupted')
  })

  // the user's ruling: holding is a choice of its own, never what a commit
  // does by itself
  it('is never held by a commit that cannot be paid for', () => {
    const declared = declareAction('m', { kind: 'firstAid' }, newId)(inTurn(board({ m: [0, 0], p: [0, 1], e: [4, 0] }, leftWith(medic('m'), SHORT), patient('p'), spearman('e')), 'm'))
    const aimed = setTarget('p')(declared)
    expect(commitAction(() => HIT, newId)(aimed)).toBe(aimed)
  })

  // the user's ruling: released on its actor's turn once they have the AP for
  // what is left of it, as it would be at the round change
  it('is released on its actor\'s turn once they have the AP for what is left', () => {
    const held = medicHolding(SHORT)
    expect(releaseHeld('m')(held)).toBe(held)
    const topped = inTurn({ ...held, characters: { ...held.characters, m: { ...held.characters.m, resources: { ...held.characters.m.resources, AP: FIRST_AID_AP } } } }, 'm')
    const released = releaseHeld('m')(topped)
    expect(getHeldOf(released, 'm')).toBeNull()
    expect(getOpenAction(released)?.kind).toBe('firstAid')
    expect(releaseHeld('m')({ ...topped, inTurnCharacter: 'e' })).toEqual({ ...topped, inTurnCharacter: 'e' })
  })

  // the user's ruling: a shot being held over is defended against once it is
  // taken up, not as it is held
  it('is defended against once released, not as it is held', () => {
    const start = board({ a: [0, 0], f: [3, 0] }, archer('a'), fighter('f'))
    const row = getFreeAttackOptions(start, start.characters.a, 'shoot')[0]
    const short = { ...start, characters: { ...start.characters, a: leftWith(start.characters.a, row.AP - 1) } }
    const aimed = setTarget('f')(declareAction('a', { kind: 'shoot', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(inTurn(short, 'a')))
    const ammo = getOpenChoices(aimed).find((c) => c.part === 'ammo' && !c.chosen)?.command
    const declared = ammo?.kind === 'amend' ? amendAction(ammo.args[0])(aimed) : aimed
    const holding = commitAction(() => HIT, newId, true)(declared)
    expect(getAvailableActions(holding, 'f').some((o) => o.available && o.draft.kind !== 'opportunityAttack')).toBe(false)
    const held = getHeldOf(holding, 'a') ? holding : rollAction(() => HIT, newId)(holding)
    expect(getHeldOf(held, 'a')?.kind).toBe('shoot')
    const topped = inTurn({ ...held, characters: { ...held.characters, a: { ...held.characters.a, resources: { ...held.characters.a.resources, AP: row.AP } } } }, 'a')
    const released = releaseHeld('a')(topped)
    expect(getOpenAction(released)?.kind).toBe('shoot')
    expect(getAvailableActions(released, 'f').some((o) => o.available && o.draft.kind !== 'opportunityAttack')).toBe(true)
  })

  // the user's ruling, priced as combat.tex "Interruption": "The AP from the
  // interrupted action is refunded, but 1 AP is lost"
  it('is dropped by its actor, who gets what it was paid back less one', () => {
    const held = medicHolding(SHORT)
    const carried = getHeldOf(held, 'm')!.carried.AP
    const dropped = dropHeld('m')(held)
    expect(getHeldOf(dropped, 'm')).toBeNull()
    expect(dropped.characters.m.resources.AP).toBe(held.characters.m.resources.AP + Math.max(0, carried - 1))
  })
})

// combat.tex "Concentration": "If multiple concentration actions finish in the
// next round, make cunning tests for all contenders and apply effects from
// highest to lowest."
describe('several actions finishing in the same round', () => {
  function twoMedics(): SceneState {
    const start = board({ a: [0, 0], pa: [0, 1], b: [3, 0], pb: [3, 1], e: [8, 0] }, leftWith(medic('a'), SHORT), patient('pa'), leftWith(medic('b'), SHORT), patient('pb'), spearman('e'))
    return tend(tend(start, 'a', 'pa'), 'b', 'pb')
  }
  const fresh = (state: SceneState): SceneState => ({ ...state, characters: Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, { ...c, usedSurge: null, resources: { ...c.resources, AP: ROUND_AP } }])) })

  it.each([[[9, 2], 'a'], [[2, 9], 'b']] as const)('puts the higher cunning roll first (%j)', (faces, first) => {
    const held = twoMedics()
    let thrown = 0
    const dice = () => faces[thrown++ % faces.length]
    const finishing = finishHeld(fresh(held), getHeldActions(held).map((h) => h.id), makeCaller({}, dice))
    expect(getOpenAction(finishing)?.actorId).toBe(first)
  })
})
