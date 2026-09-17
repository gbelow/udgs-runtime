import { describe, it, expect } from 'vitest'
import { duplicateItem, addItemToContainer, removeItemFromContainer } from './items'
import { makeCharacter } from '../../factories'
import { ContainerSchema, ItemSchema } from '../../types'

function characterWithPack() {
  return makeCharacter({
    containers: { pack: ContainerSchema.parse({ name: 'Backpack', kind: 'backpack', slots: { medium: { numSlots: 12 } } }) },
  })
}

const coin = (amount = 1) => ItemSchema.parse({ name: 'Coin', bulk: 0, amount })

// An item is addressed by its id — it is how a stack is split, moved and
// removed — so a copy must never share one with its original.
describe('duplicateItem', () => {
  it('changes the id and nothing else', () => {
    const original = coin(5)
    const copy = duplicateItem(original)
    expect(copy.id).not.toBe(original.id)
    expect({ ...copy, id: '' }).toEqual({ ...original, id: '' })
  })

  it('gives every copy its own id', () => {
    const original = coin(5)
    const ids = Array.from({ length: 25 }, () => duplicateItem(original).id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('items go into a container and come back out', () => {
  it('leaves the container as it found it', () => {
    const before = characterWithPack()
    const item = coin()
    const after = removeItemFromContainer('pack', item.id)(addItemToContainer('pack', 'medium', item)(before))
    expect(after.containers).toEqual(before.containers)
  })

  it('removes only the item named', () => {
    const kept = coin(1)
    const dropped = ItemSchema.parse({ name: 'Vial', bulk: 0, amount: 2 })
    const loaded = addItemToContainer('pack', 'medium', dropped)(addItemToContainer('pack', 'medium', kept)(characterWithPack()))
    const after = removeItemFromContainer('pack', dropped.id)(loaded)
    expect(after.containers.pack.slots.medium.items.map((item) => item.id)).toEqual([kept.id])
  })

  it('takes part of a stack and leaves the rest', () => {
    const stack = coin(5)
    const loaded = addItemToContainer('pack', 'medium', stack)(characterWithPack())
    const after = removeItemFromContainer('pack', stack.id, 2)(loaded)
    expect(after.containers.pack.slots.medium.items).toEqual([{ ...stack, amount: 3 }])
  })
})

// gear.tex "Slot size and stacking": a slot holds "an item or stack of items"
// and "only identical items can be stacked together". Adding a coin to a
// group that already holds coins joins that stack; a different item does not.
describe('stacking', () => {
  it('joins an identical stack instead of taking a slot', () => {
    const c = addItemToContainer('pack', 'medium', coin(3))(addItemToContainer('pack', 'medium', coin(2))(characterWithPack()))
    expect(c.containers.pack.slots.medium.items.map((item) => item.amount)).toEqual([5])
  })

  it('keeps a different item as a stack of its own', () => {
    const c = addItemToContainer('pack', 'medium', ItemSchema.parse({ name: 'Vial', bulk: 0 }))(addItemToContainer('pack', 'medium', coin(2))(characterWithPack()))
    expect(c.containers.pack.slots.medium.items.map((item) => item.name)).toEqual(['Coin', 'Vial'])
  })
})

// Either the item goes in or nothing happens: a container that does not exist,
// or an item that does not fit, must not leave a half-loaded character behind.
describe('adding is all or nothing', () => {
  it('refuses a container that is not there', () => {
    expect(() => addItemToContainer('missing', 'quick', coin())(characterWithPack())).toThrow()
  })

  it('refuses an item too bulky for the slots', () => {
    expect(() => addItemToContainer('pack', 'medium', ItemSchema.parse({ name: 'Crate', bulk: 3 }))(characterWithPack())).toThrow()
  })

  it('refuses a stack that would overflow the container', () => {
    const c = characterWithPack()
    expect(() => addItemToContainer('pack', 'medium', ItemSchema.parse({ name: 'Bricks', bulk: 2, amount: 13 }))(c)).toThrow()
  })
})
