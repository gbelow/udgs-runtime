import { describe, it, expect } from 'vitest'
import { ContainerSchema, ItemSchema, type CampaignCharacter, type Item } from '../../types'
import { makeCampaignCharacter } from '../../factories'
import { getDeathIL } from '../../character/rules/afflictions'
import { SceneStateSchema, type SceneState } from '../types'
import { CampaignStateSchema } from '../../campaign/types'
import { returnFromFight, sendToFight } from './fight'
import { commitAction, declareAction } from './action'
import { layToRest } from './characters'
import { joinFight } from './parties'
import { pickFloorItem } from './floor'
import { canPickUp } from '../rules/floor'
import { getOpenables, getReachableLoot } from '../rules/loot'
import { getRootTestTerms } from '../rules/attack'
import { getDegree } from '../../play/test'
import { sumTerms } from '../../character/rules/terms'
import { setTarget, resolveAction } from './action'
import { chooseTheft } from './choices'
import type { Degree } from '../../types'
import { drawItem } from '../../item/commands/hands'
import { doffArmor } from '../../character/commands/armor'

const stuff = (id: string, name: string): Item => ItemSchema.parse({ id, name, type: 'misc', refId: name, bulk: 1 })

const withPack = (name: string, items: Item[]) => ContainerSchema.parse({ name, kind: 'backpack', slots: { quick: { numSlots: 4, items } } })

const sheet = (id: string): CampaignCharacter => ({ ...makeCampaignCharacter({ name: id }), id })

const dead = (c: CampaignCharacter): CampaignCharacter => ({ ...c, injuries: { ...c.injuries, injuryLevel: getDeathIL(c) } })

let n = 0
const newId = () => `id${++n}`

// a looter, a fallen character with a backpack and a bag lying on the floor
function scene(): SceneState {
  const body = dead({ ...sheet('b'), containers: { pack: withPack('backpack', [stuff('rope', 'Rope'), stuff('flint', 'Flint')]) } })
  const bag = ItemSchema.parse({ id: 'bag', name: 'Bag', type: 'container', refId: 'Bag', bulk: 2, container: withPack('bag', [stuff('coin', 'Coin')]) })
  const joined = [sheet('a'), body].reduce((s, c) => joinFight(c, c.id, c.name, [])(s), SceneStateSchema.parse({}))
  return layToRest({ ...joined, floor: [{ item: bag, cell: null, planted: null }] })
}

const play = (state: SceneState, draft: Parameters<typeof declareAction>[1]): SceneState => commitAction(() => 5, newId)(declareAction('a', draft, newId)(state))

const opened = (state: SceneState): SceneState => getOpenables(state, 'a').reduce((s, o) => play(s, { kind: 'open', key: o.key }), state)

describe('the dead', () => {
  // the table's ruling: a dead character leaves their party at the moment of
  // death and stays a character, whole
  it('leave their party and stay characters', () => {
    const lying = scene()
    expect(lying.partyOf.b).toBeUndefined()
    expect(lying.characters.b.name).toBe('b')
    expect(lying.characters.b.containers.pack.name).toBe('backpack')
  })

  // the table's ruling: carrying a corpse is storing it, so the dead are not
  // given back to the roster with their party
  it('are left where they fell when the fight is given back', () => {
    const campaign = CampaignStateSchema.parse({ characters: { a: sheet('a'), b: dead(sheet('b')) } })
    const sent = sendToFight(['a', 'b'])({ campaign, fight: SceneStateSchema.parse({}) })
    const back = returnFromFight(['a', 'b'], 0)({ ...sent, fight: layToRest(sent.fight) })
    expect(Object.keys(back.campaign.characters)).toEqual(['a'])
    expect(back.campaign.fallen[''].map((c) => c.id)).toEqual(['b'])
    expect(back.fight.characters).toEqual({})
  })
})

describe('looting', () => {
  // the table's ruling: a container has to be opened to rummage through it
  it('finds nothing in a container that is shut', () => {
    const lying = scene()
    const shut = getOpenables(lying, 'a')
    expect(shut.length).toBeGreaterThan(0)
    expect(shut.every((o) => !o.opened)).toBe(true)
    const inside = new Set(['rope', 'flint', 'coin'])
    expect(getReachableLoot(lying, 'a').filter((l) => inside.has(l.item.id))).toEqual([])
    const tried = pickFloorItem('a', 'rope', newId, { kind: 'pack', holder: 'b', container: 'pack' })(lying)
    expect(commitAction(() => 5, newId)(tried).characters.a.held).toEqual([])
  })

  it('shows what a container holds once it is opened', () => {
    const open = opened(scene())
    const inside = new Set(['rope', 'flint', 'coin'])
    expect(getReachableLoot(open, 'a').filter((l) => inside.has(l.item.id)).map((l) => l.item.id).sort()).toEqual(['coin', 'flint', 'rope'])
  })

  // taking an item takes that item from where it lay, and nothing else
  it('takes exactly the item picked, from the place it lay', () => {
    const open = opened(scene())
    const looter = open.characters.a
    // a container taken carries what it holds away with it
    const loot = getReachableLoot(open, 'a').filter((l) => !l.item.container && canPickUp(looter, l.item))
    expect(loot.length).toBeGreaterThan(0)
    for (const { item, from } of loot) {
      const after = commitAction(() => 5, newId)(pickFloorItem('a', item.id, newId, from)(open))
      const taken = getReachableLoot(after, 'a')
      expect(after.characters.a.held.map((i) => i.refId)).toContain(item.refId)
      expect(taken.some((l) => l.item.id === item.id && JSON.stringify(l.from) === JSON.stringify(from))).toBe(false)
      expect(taken.length).toBe(getReachableLoot(open, 'a').length - 1)
    }
  })
})

describe('what a body has on it', () => {
  // the table's ruling: everything is lootable
  it('is all to be had: its hands, its back, its armor and the containers it wears', () => {
    const body = dead({
      ...sheet('b'),
      held: [stuff('blade', 'Blade')],
      onBack: stuff('buckler', 'Buckler'),
      worn: stuff('mail', 'Mail'),
      containers: { pack: withPack('backpack', [stuff('rope', 'Rope')]) },
    })
    const lying = layToRest([sheet('a'), body].reduce((s, c) => joinFight(c, c.id, c.name, [])(s), SceneStateSchema.parse({})))
    const ids = getReachableLoot(lying, 'a').map((l) => l.item.id)
    for (const id of ['blade', 'buckler', 'mail', 'b:pack']) expect(ids).toContain(id)
  })

  // the table's ruling: the cost is the same as using one's own inventory
  it('costs what the same move costs from the looter own inventory', () => {
    const goods = [stuff('rope', 'Rope'), { ...stuff('tent', 'Tent'), bulk: 2 }, { ...stuff('anvil', 'Anvil'), bulk: 3 }]
    const container = ContainerSchema.parse({ name: 'backpack', kind: 'backpack', slots: { quick: { numSlots: 4, items: [goods[0]] }, medium: { numSlots: 4, items: [goods[1]] }, large: { numSlots: 4, items: [goods[2]] } } })
    const fresh = (c: CampaignCharacter): CampaignCharacter => ({ ...c, resources: { ...c.resources, AP: 40 } })
    const body = dead({ ...sheet('b'), containers: { pack: container } })
    const started = (s: SceneState): SceneState => ({ ...s, round: 1, inTurnCharacter: 'a', characters: { ...s.characters, a: fresh(s.characters.a) } })
    const lying = started(layToRest([sheet('a'), body].reduce((s, c) => joinFight(c, c.id, c.name, [])(s), SceneStateSchema.parse({}))))
    const open = play(lying, { kind: 'open', key: 'b:pack' })
    for (const { id } of goods) {
      const before = open.characters.a.resources.AP
      const looted = commitAction(() => 5, newId)(pickFloorItem('a', id, newId, { kind: 'pack', holder: 'b', container: 'pack' })(open))
      const own = drawItem('pack', id)({ ...fresh(sheet('x')), containers: { pack: container } }, true) as CampaignCharacter
      expect(before - looted.characters.a.resources.AP).toBe(40 - own.resources.AP)
    }
  })

  it('takes armor off at the price of doffing it', () => {
    const mail = stuff('mail', 'Mail')
    const body = dead({ ...sheet('b'), worn: mail })
    const fresh = (c: CampaignCharacter): CampaignCharacter => ({ ...c, resources: { ...c.resources, AP: 40 } })
    const base = layToRest([sheet('a'), body].reduce((s, c) => joinFight(c, c.id, c.name, [])(s), SceneStateSchema.parse({})))
    const lying = { ...base, round: 1, inTurnCharacter: 'a', characters: { ...base.characters, a: fresh(base.characters.a) } }
    const looted = commitAction(() => 5, newId)(pickFloorItem('a', 'mail', newId, { kind: 'worn', holder: 'b' })(lying))
    const own = doffArmor(null)({ ...fresh(sheet('x')), worn: mail }, true) as CampaignCharacter
    expect(looted.characters.a.held.map((i) => i.id)).toContain('mail')
    expect(40 - looted.characters.a.resources.AP).toBe(40 - own.resources.AP)
  })
})

describe('theft', () => {
  const from = { kind: 'pack', holder: 'b', container: 'pack' } as const

  function robbery(): SceneState {
    const victim = { ...sheet('b'), containers: { pack: withPack('backpack', [stuff('rope', 'Rope')]) } }
    const joined = [sheet('a'), victim].reduce((s, c) => joinFight(c, c.id, c.name, [])(s), SceneStateSchema.parse({}))
    const resting = { ...joined, round: 1, turn: 1, turnsBegun: 1, inTurnCharacter: 'a', stealthTurns: [{ turn: 1, id: 'a', hiddenFrom: ['b'], AP: 0, heardAP: 0 }] }
    return { ...resting, characters: { ...resting.characters, a: { ...resting.characters.a, resources: { ...resting.characters.a.resources, AP: 40 } } } }
  }

  // a die that comes to the degree against the test as declared
  function dieFor(state: SceneState, degree: Degree): () => number {
    const open = Object.values(state.actions).find((a) => a.kind === 'steal')!
    const terms = getRootTestTerms(state, open)!
    const die = Array.from({ length: 200 }, (_, i) => i - 100).find((n) => getDegree(n + sumTerms(terms.skill), sumTerms(terms.DL)) === degree)!
    return () => die
  }

  function steal(degree: Degree, take = true): SceneState {
    const declared = setTarget('b')(declareAction('a', { kind: 'steal', itemId: 'rope', from }, newId)(robbery()))
    const rolled = commitAction(dieFor(declared, degree), newId)(declared)
    return resolveAction(newId, () => 5)(chooseTheft(take)(rolled))
  }

  const noticed = (s: SceneState) => !s.stealthTurns[0].hiddenFrom.includes('b')
  const holds = (s: SceneState) => s.characters.a.held.some((i) => i.id === 'rope')
  const carries = (s: SceneState) => s.characters.b.containers.pack.slots.quick.items.some((i) => i.id === 'rope')

  // combat.tex "Theft": "On criticals, it is stolen without being noticed. On
  // successes, the character can choose between successfully stealing or
  // failing without drawing attention. On grazes and failures, attention is
  // drawn and it fails."
  it.each([
    ['critical', true, { stolen: true, noticed: false }],
    ['hit', true, { stolen: true, noticed: true }],
    ['hit', false, { stolen: false, noticed: false }],
    ['graze', true, { stolen: false, noticed: true }],
    ['miss', true, { stolen: false, noticed: true }],
  ] as const)('on a %s (taking it: %s) comes to %j', (degree, take, outcome) => {
    const after = steal(degree, take)
    expect({ stolen: holds(after), noticed: noticed(after) }).toEqual(outcome)
    expect(carries(after)).toBe(!outcome.stolen)
  })
})
