import { describe, it, expect } from 'vitest'
import { holdItem, regripItem, drawItem, storeItem, dropItem } from './hands'
import { getDrawCost, getStoreCost, getGrip } from '../lenses/hands'
import { canFitItem } from '../lenses/containers'
import { makeCharacter, makeCampaignCharacter } from '../../factories'
import { isCampaignCharacter } from '../../utils'
import { ContainerSchema, HandSchema, ItemSchema } from '../../types'
import type { Character, CharacterUpdater, Item, SlotKind } from '../../types'

const coin = () => ItemSchema.parse({ name: 'Coin', bulk: 0 })
const dagger = () => ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 })
const spear = () => ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })
const book = () => ItemSchema.parse({ name: 'Book', bulk: 2 })

// A belt, a bandolier and a backpack: quick slots of two bulks, and slots that
// are not quick at all.
function carrying(): Character {
  return makeCharacter({
    containers: {
      belt: ContainerSchema.parse({ name: 'Belt', kind: 'belt', slots: { quick: { numSlots: 4, slotBulk: 2 } } }),
      sash: ContainerSchema.parse({ name: 'Bandolier', kind: 'bandolier', slots: { quick: { numSlots: 8, slotBulk: 1 } } }),
      pack: ContainerSchema.parse({ name: 'Backpack', kind: 'backpack', slots: { medium: { numSlots: 12 }, large: { numSlots: 2 } } }),
    },
  })
}

const holding = (c: Character, ...items: Item[]) => items.reduce((acc, item) => holdItem(item)(acc), c)
const ap = (c: Character) => (isCampaignCharacter(c) ? c.resources.AP : NaN)

// Every hand names a stack that is there, every stack is in some hand, and no
// stack is in more than two. The commands each keep this; a sequence of them
// has to as well.
function expectGripConsistent(c: Character) {
  const stacks = new Set(c.held.map((item) => item.id))
  for (const hand of c.hands) {
    if (hand.itemId) expect(stacks.has(hand.itemId)).toBe(true)
  }
  for (const item of c.held) {
    expect(getGrip(c, item.id)).toBeGreaterThanOrEqual(1)
    expect(getGrip(c, item.id)).toBeLessThanOrEqual(2)
  }
}

describe('the grip stays consistent', () => {
  const d = dagger()
  const s = spear()
  const steps: [string, CharacterUpdater][] = [
    ['hold a dagger', holdItem(d)],
    ['grip it with two hands', regripItem(d.id, 2)],
    ['back to one', regripItem(d.id, 1)],
    ['store it on the belt', storeItem(d.id, 'belt', 'quick')],
    ['draw it again', (c) => drawItem('belt', c.containers.belt.slots.quick.items[0].id)(c)],
    ['hold a spear in the other hand', holdItem(s)],
    ['drop the spear', dropItem(s.id)],
    ['drop the dagger', (c) => dropItem(c.held[0].id)(c)],
  ]

  it('after every step of a sequence', () => {
    let c = carrying()
    for (const [, step] of steps) {
      c = step(c)
      expectGripConsistent(c)
    }
    expect(c.held).toEqual([])
  })
})

// The rule as stated: an item must leave the hand before another goes in, and
// only a hand that can hold takes gear at all.
describe('hands take one stack each', () => {
  it('refuses a stack when every holding hand is full', () => {
    const full = holding(carrying(), dagger(), dagger())
    expect(() => holdItem(coin())(full)).toThrow()
    expect(() => drawItem('belt', 'x')(full)).toThrow()
  })

  it('never puts gear in a hand that cannot hold', () => {
    const paws = makeCharacter({ hands: [HandSchema.parse({ name: 'paw', canHold: false }), HandSchema.parse({ name: 'maw', canHold: false })] })
    expect(() => holdItem(coin())(paws)).toThrow()
    expect(paws.hands.every((hand) => hand.itemId === '')).toBe(true)
  })

  it('needs a second free holding hand to grip with two', () => {
    const c = holding(carrying(), dagger(), dagger())
    expect(() => regripItem(c.held[0].id, 2)(c)).toThrow()
  })
})

describe('a stack drawn and put back', () => {
  it('leaves the containers and the hands as they were', () => {
    const before = ItemSchema.parse({ name: 'Coin', bulk: 0, amount: 5 })
    const loaded = { ...carrying(), containers: { ...carrying().containers } }
    loaded.containers.sash = { ...loaded.containers.sash, slots: { ...loaded.containers.sash.slots, quick: { ...loaded.containers.sash.slots.quick, items: [before] } } }
    const drawn = drawItem('sash', before.id)(loaded)
    const after = storeItem(drawn.held[0].id, 'sash', 'quick')(drawn)
    expect(after.containers).toEqual(loaded.containers)
    expect(after.hands).toEqual(loaded.hands)
    expect(after.held).toEqual(loaded.held)
  })
})

// The lens says the price and the command charges it: two readings of the same
// rule that have to agree for every slot group an item can come out of or go
// into. A character in play with too little AP is left exactly as it was.
describe('drawing and storing charge what the lens prices', () => {
  const items = [coin(), dagger(), book(), spear()]
  const groups: [string, SlotKind][] = [['belt', 'quick'], ['sash', 'quick'], ['pack', 'medium'], ['pack', 'large']]

  const inPlay = (ap: number, containerKey: string, slot: SlotKind, item: Item) =>
    makeCampaignCharacter({
      ...carrying(),
      type: 'campaign',
      resources: { AP: ap, STA: 10, hunger: 0, thirst: 0, exhaustion: 0 },
      containers: {
        ...carrying().containers,
        [containerKey]: {
          ...carrying().containers[containerKey],
          slots: { ...carrying().containers[containerKey].slots, [slot]: { ...carrying().containers[containerKey].slots[slot], items: [item] } },
        },
      },
    })

  for (const [containerKey, slot] of groups) {
    for (const item of items) {
      const stack = { ...item, id: `${item.name}-${containerKey}-${slot}` }
      if (!canFitItem(carrying().containers[containerKey], slot, stack)) continue

      it(`drawing ${item.name} from ${containerKey} ${slot}`, () => {
        const c = inPlay(20, containerKey, slot, stack)
        const cost = getDrawCost(c, slot, stack)
        const drawn = drawItem(containerKey, stack.id)(c)
        expect(ap(drawn)).toBe(20 - cost.AP)
        if (cost.AP > 0) {
          const broke = inPlay(cost.AP - 1, containerKey, slot, stack)
          expect(drawItem(containerKey, stack.id)(broke)).toEqual(broke)
        }
      })

      it(`storing ${item.name} into ${containerKey} ${slot}`, () => {
        const c = holdItem(stack)(inPlay(20, 'belt', 'quick', coin()))
        const cost = getStoreCost(c, slot, stack)
        const stored = storeItem(stack.id, containerKey, slot)(c)
        expect(ap(stored)).toBe(20 - cost.AP)
        const broke = holdItem(stack)(inPlay(cost.AP - 1, 'belt', 'quick', coin()))
        expect(storeItem(stack.id, containerKey, slot)(broke)).toEqual(broke)
      })
    }
  }

  it('dropping is free', () => {
    const c = holdItem(spear())(inPlay(20, 'belt', 'quick', coin()))
    expect(ap(dropItem(c.held[0].id)(c))).toBe(20)
  })
})

// Ingestion is the boundary the grip crosses: whatever the stored data says,
// the character that comes out has every hand on a stack that exists and
// every stack in a hand.
describe('ingestion reconciles the grip', () => {
  it('frees a hand on a stack that is not there', () => {
    const c = makeCharacter({ hands: [{ itemId: 'ghost' }, {}] })
    expect(c.hands.map((hand) => hand.itemId)).toEqual(['', ''])
  })

  it('drops a stack no hand is on', () => {
    const c = makeCharacter({ held: [{ id: 'loose', name: 'Coin' }] })
    expect(c.held).toEqual([])
  })

  it('keeps a stack a hand is on', () => {
    const c = makeCharacter({ hands: [{ itemId: 'd' }, {}], held: [{ id: 'd', name: 'Dagger' }] })
    expect(c.held.map((item) => item.id)).toEqual(['d'])
    expect(c.hands[0].itemId).toBe('d')
  })
})
