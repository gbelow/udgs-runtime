import { describe, it, expect } from 'vitest'
import { ContainerSchema, ItemSchema, type CampaignCharacter, type Item } from '../../types'
import { makeCampaignCharacter } from '../../factories'
import { getDeathIL } from '../../character/rules/afflictions'
import { SceneStateSchema, type SceneState } from '../types'
import { commitAction, declareAction } from './action'
import { layToRest, reviveBody } from './characters'
import { joinFight } from './parties'
import { pickFloorItem } from './floor'
import { canPickUp } from '../rules/floor'
import { getOpenables, getReachableLoot } from '../rules/loot'

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
  // death, keeps all their data, and may be revived
  it('leave the fight whole and come back as they were, one below death', () => {
    const lying = scene()
    const body = lying.bodies[0].character
    expect(lying.characters.b).toBeUndefined()
    expect(lying.partyOf.b).toBeUndefined()
    const revived = reviveBody('b', 'a')(lying)
    expect(revived.bodies).toEqual([])
    expect(revived.partyOf.b).toBe('a')
    expect({ ...revived.characters.b, injuries: body.injuries }).toEqual(body)
    expect(revived.characters.b.injuries.injuryLevel).toBe(getDeathIL(body) - 1)
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
    const tried = pickFloorItem('a', 'rope', newId, { kind: 'pack', body: 'b', container: 'pack' })(lying)
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
