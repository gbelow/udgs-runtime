import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type Action, type ActionKind, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { ACTIONS } from '../actionCatalog'
import { getAvailableActions, getOpenAction, getReactionsTo } from '../lenses/action'
import { reduceCharacter } from '../reduce'
import { cancelAction, commitAction, declareAction, declareReaction, resolveAction, rollAction, setTarget } from './action'

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, resources: { ...base.resources, AP: 8, STA: 6 } }
}

function combat(...characters: CampaignCharacter[]): CombatState {
  return { ...CombatStateSchema.parse({}), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}

let n = 0
const newId = () => `a${++n}`

// A strike committed at every step short of the die, with the defender's
// reaction in place: the last state the table can still walk away from.
function declared(): CombatState {
  let s = combat(fighter('atk'), fighter('def'))
  s = declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(s)
  s = setTarget('def')(s)
  s = commitAction()(s)
  s = declareReaction('def', { kind: 'evade' }, newId)(s)
  return s
}

describe('the three phases', () => {
  // Nothing is paid before the die: walking away from a declared action
  // leaves every character as they were. The commit is the table's word: from
  // it the action is played out, and cancelling is refused.
  it('cancelling a declared action leaves every character untouched, and a committed one cannot be', () => {
    let before = combat(fighter('atk'), fighter('def'))
    before = declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(before)
    before = setTarget('def')(before)
    const after = cancelAction()(before)
    expect(after.characters).toEqual(before.characters)
    expect(getOpenAction(after)).toBeNull()
    expect(after.actions).toHaveLength(0)

    const committed = declared()
    expect(cancelAction()(committed)).toEqual(committed)
  })

  // The roll and the payment are one step: in the state where the die is
  // known, every price it committed has already left its payer.
  it('the roll pays every declared price in the same state', () => {
    const before = declared()
    const after = rollAction(5)(before)
    const open = getOpenAction(after)
    expect(open?.roll).not.toBeNull()

    for (const action of [open!, ...getReactionsTo(after, open!.id)]) {
      const was = before.characters[action.actorId].resources
      const is = after.characters[action.actorId].resources
      expect(action.cost).not.toBeNull()
      expect(was.AP - is.AP).toBe(action.cost!.AP)
      expect(was.STA - is.STA).toBe(action.cost!.STA)
    }
  })

  // Once the die is thrown there is no way back: the action can only be
  // played out, and nothing is refunded by trying.
  it('a rolled action cannot be cancelled', () => {
    const rolled = rollAction(5)(declared())
    expect(cancelAction()(rolled)).toEqual(rolled)
    expect(getOpenAction(resolveAction()(rolled))).toBeNull()
  })

  // A price that cannot be paid stops the die: the state is left exactly as
  // declared rather than rolled and half paid.
  it('refuses the roll when someone cannot pay, and changes nothing', () => {
    const before = declared()
    const broke = { ...before, characters: { ...before.characters, def: { ...before.characters.def, resources: { ...before.characters.def.resources, AP: 0 } } } }
    expect(rollAction(5)(broke)).toEqual(broke)
  })
})

describe('the reducer', () => {
  // An action concerns its actor and its target; a fight runs everyone else
  // through the same reducer and they must come out as they went in.
  const kinds = Object.keys(ACTIONS) as ActionKind[]
  it.each(kinds)('%s leaves a character with no part in it untouched', (kind) => {
    const bystander = fighter('other')
    const action = { kind, id: 'x', actorId: 'atk', targetId: 'def', reactionTo: null, status: 'rolled', cost: { AP: 3, STA: 1 }, roll: null, spent: {}, weaponKey: '', attack: '', variant: '', location: 'chest' } as Action
    expect(reduceCharacter(action, 'roll')(bystander)).toEqual(bystander)
    expect(reduceCharacter(action, 'resolve')(bystander)).toEqual(bystander)
  })
})

describe('what can be declared', () => {
  // combat.tex "Reactions": a reaction "must be triggered by something". With
  // no action open, nobody has one to declare; with one open but not yet
  // committed to, there is nothing final to answer either.
  it('offers no reaction while nothing is committed', () => {
    const s = combat(fighter('atk'), fighter('def'))
    for (const id of ['atk', 'def']) {
      expect(getAvailableActions(s, id).filter((o) => o.reactionTo !== null)).toHaveLength(0)
    }
    const aimed = setTarget('def')(declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(s))
    expect(getAvailableActions(aimed, 'def').filter((o) => o.reactionTo !== null)).toHaveLength(0)
    expect(declareReaction('def', { kind: 'evade' }, newId)(aimed)).toEqual(aimed)
  })

  // The command refuses exactly what the list shows as closed: an option the
  // list does not offer, or offers as unavailable, declares nothing.
  it('declares only what the list offers as available', () => {
    const s = combat(fighter('atk'), fighter('def'))
    const opened = declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(s)
    const aimed = commitAction()(setTarget('def')(opened))
    expect(declareReaction('atk', { kind: 'evade' }, newId)(aimed)).toEqual(aimed)
    expect(declareReaction('def', { kind: 'block', weaponKey: 'no-such', attack: 'x' }, newId)(aimed)).toEqual(aimed)
    for (const option of getAvailableActions(aimed, 'def')) {
      const next = declareReaction('def', option.draft, newId)(aimed)
      expect(next !== aimed).toBe(option.available)
    }
  })
})
