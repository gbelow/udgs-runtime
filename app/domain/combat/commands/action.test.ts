import { describe, it, expect } from 'vitest'
import { BoardSchema, CombatStateSchema, type Action, type ActionKind, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { holdItem, regripItem } from '../../item/commands/hands'
import { ACTIONS } from '../rules/actionCatalog'
import { getAvailableActions } from '../rules/options'
import { getOpenAction, getReactionsTo } from '../rules/log'
import { reduceCharacter } from './reduce'
import { amendAction, cancelAction, commitAction, declareAction, declareReaction, payAction, resolveAction, rollAction, setTarget } from './action'
import { getTerrainPaint } from '../rules/explosion'
import { produceEffects } from '../../character/rules/production'
import { SPELLS } from '../../spells'

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, resources: { ...base.resources, AP: 8, STA: 6 } }
}

function combat(...characters: CampaignCharacter[]): CombatState {
  return { ...CombatStateSchema.parse({}), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}

let n = 0
const newId = () => `a${++n}`

// A shooter with a bow in both hands and the focus surge spent (combat.tex
// "Focus surge": "required to use ranged attacks").
function archer(id: string): CampaignCharacter {
  const bow = ItemSchema.parse({ name: 'Short Bow', type: 'weapon', refId: 'Short Bow', bulk: 2 })
  return { ...(regripItem(bow.id, 2)(holdItem(bow)(fighter(id))) as CampaignCharacter), usedSurge: 'focus' }
}

// The two weapon attacks, each aimed at a defender who answers it: the
// attacker, the declaration and the reaction that goes with it.
const attacks = [
  { kind: 'strike', attacker: fighter, draft: { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, reaction: { kind: 'evade' } },
  { kind: 'shoot', attacker: archer, draft: { kind: 'shoot', weaponKey: '', attack: 'shoot', variant: 'basic' }, reaction: { kind: 'evasion' } },
] as const

function aimed(attack: (typeof attacks)[number]): CombatState {
  const atk = attack.attacker('atk')
  const weaponKey = attack.draft.weaponKey || atk.held[0].id
  let s = combat(atk, fighter('def'))
  s = declareAction('atk', { ...attack.draft, weaponKey }, newId)(s)
  return setTarget('def')(s)
}

// An attack committed at every step short of the die, with the defender's
// reaction in place: the last state the table can still walk away from.
function declared(attack: (typeof attacks)[number]): CombatState {
  let s = commitAction()(aimed(attack))
  s = declareReaction('def', attack.reaction, newId)(s)
  return s
}

describe.each(attacks)('the three phases of a $kind', (attack) => {
  // Nothing is paid before the die: walking away from a declared action
  // leaves every character as they were. The commit is the table's word: from
  // it the action is played out, and cancelling is refused.
  it('cancelling a declared action leaves every character untouched, and a committed one cannot be', () => {
    const before = aimed(attack)
    const after = cancelAction()(before)
    expect(after.characters).toEqual(before.characters)
    expect(getOpenAction(after)).toBeNull()
    expect(after.actions).toHaveLength(0)

    const committed = declared(attack)
    expect(cancelAction()(committed)).toEqual(committed)
  })

  // The roll and the payment are one step: in the state where the die is
  // known, every price it committed has already left its payer.
  it('the roll pays every declared price in the same state', () => {
    const before = declared(attack)
    expect(getReactionsTo(before, getOpenAction(before)!.id)).toHaveLength(1)
    const after = rollAction(() => 5, newId)(before)
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
    const rolled = rollAction(() => 5, newId)(declared(attack))
    expect(cancelAction()(rolled)).toEqual(rolled)
    expect(getOpenAction(resolveAction(newId)(rolled))).toBeNull()
  })

  // A price that cannot be paid stops the die: the state is left exactly as
  // declared rather than rolled and half paid.
  it('refuses the roll when someone cannot pay, and changes nothing', () => {
    const before = declared(attack)
    const broke = { ...before, characters: { ...before.characters, def: { ...before.characters.def, resources: { ...before.characters.def.resources, AP: 0 } } } }
    expect(rollAction(() => 5, newId)(broke)).toEqual(broke)
  })
})

describe('the reducer', () => {
  // An action concerns its actor and its target; a fight runs everyone else
  // through the same reducer and they must come out as they went in.
  const kinds = Object.keys(ACTIONS) as ActionKind[]
  it.each(kinds)('%s leaves a character with no part in it untouched', (kind) => {
    const bystander = fighter('other')
    const action = { kind, id: 'x', actorId: 'atk', targetId: 'def', reactionTo: null, step: 'post', cost: { AP: 3, STA: 1 }, roll: null, spent: {}, weaponKey: '', attack: '', variant: '', location: 'chest' } as Action
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
  it.each(attacks)('declares only what the list offers as available against a $kind', (attack) => {
    const committed = commitAction()(aimed(attack))
    expect(declareReaction('atk', attack.reaction, newId)(committed)).toEqual(committed)
    expect(declareReaction('def', { kind: 'block', weaponKey: 'no-such', attack: 'x' }, newId)(committed)).toEqual(committed)
    expect(getAvailableActions(committed, 'def').length).toBeGreaterThan(0)
    for (const option of getAvailableActions(committed, 'def')) {
      const next = declareReaction('def', option.draft, newId)(committed)
      expect(next !== committed).toBe(option.available)
    }
  })
})

// A charge set off, or a charged item thrown, is consumed by the blast
// before the board is painted; the gas was read off the charge after it had
// gone, so a smoke charge left no smoke.
describe('a charge set off', () => {
  it('leaves on the ground what it said it would', () => {
    const base = fighter('a')
    const bomb = ItemSchema.parse({ id: 'bomb', name: 'bomb' })
    const charge = { key: 'smoke-explosive', effects: produceEffects(base, SPELLS['smoke-explosive'].effects) }
    let s: CombatState = {
      ...combat({ ...base, fightName: 'a', held: [{ ...bomb, charge }] }),
      board: BoardSchema.parse({ placements: { a: { cell: { q: 0, r: 0 } } } }),
    }
    s = amendAction({ center: { q: 0, r: 0 } })(declareAction('a', { kind: 'explosion', source: 'detonate', itemId: 'bomb' }, newId)(s))
    const open = getOpenAction(s)
    const painted = open?.kind === 'explosion' ? getTerrainPaint(s, open).length : 0
    expect(painted).toBeGreaterThan(0)
    const after = resolveAction(newId)(payAction(newId)(commitAction()(s)))
    expect(Object.keys(after.board?.terrain ?? {})).toHaveLength(painted)
  })
})
