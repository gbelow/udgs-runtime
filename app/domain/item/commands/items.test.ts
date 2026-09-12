import { describe, it, expect } from 'vitest'
import { duplicateItem, addItemToContainer, removeItemFromContainer } from './items'
import { makeCharacter } from '../../factories'
import { ContainerSchema, ItemSchema } from '../../types'

function characterWithBelt() {
  return makeCharacter({
    containers: { belt: ContainerSchema.parse({ name: 'Belt', kind: 'belt', slots: { quick: { numSlots: 4, slotBulk: 1 } } }) },
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
    const before = characterWithBelt()
    const item = coin()
    const after = removeItemFromContainer('belt', item.id)(addItemToContainer('belt', 'quick', item)(before))
    expect(after.containers).toEqual(before.containers)
  })

  it('removes only the item named', () => {
    const kept = coin(1)
    const dropped = ItemSchema.parse({ name: 'Vial', bulk: 0, amount: 2 })
    const loaded = addItemToContainer('belt', 'quick', dropped)(addItemToContainer('belt', 'quick', kept)(characterWithBelt()))
    const after = removeItemFromContainer('belt', dropped.id)(loaded)
    expect(after.containers.belt.slots.quick.items.map((item) => item.id)).toEqual([kept.id])
  })

  it('takes part of a stack and leaves the rest', () => {
    const stack = coin(5)
    const loaded = addItemToContainer('belt', 'quick', stack)(characterWithBelt())
    const after = removeItemFromContainer('belt', stack.id, 2)(loaded)
    expect(after.containers.belt.slots.quick.items).toEqual([{ ...stack, amount: 3 }])
  })
})

// gear.tex "Slot size and stacking": a slot holds "an item or stack of items"
// and "only identical items can be stacked together". Adding a coin to a
// group that already holds coins joins that stack; a different item does not.
describe('stacking', () => {
  it('joins an identical stack instead of taking a slot', () => {
    const c = addItemToContainer('belt', 'quick', coin(3))(addItemToContainer('belt', 'quick', coin(2))(characterWithBelt()))
    expect(c.containers.belt.slots.quick.items.map((item) => item.amount)).toEqual([5])
  })

  it('keeps a different item as a stack of its own', () => {
    const c = addItemToContainer('belt', 'quick', ItemSchema.parse({ name: 'Vial', bulk: 0 }))(addItemToContainer('belt', 'quick', coin(2))(characterWithBelt()))
    expect(c.containers.belt.slots.quick.items.map((item) => item.name)).toEqual(['Coin', 'Vial'])
  })
})

// Either the item goes in or nothing happens: a container that does not exist,
// or an item that does not fit, must not leave a half-loaded character behind.
describe('adding is all or nothing', () => {
  it('refuses a container that is not there', () => {
    expect(() => addItemToContainer('missing', 'quick', coin())(characterWithBelt())).toThrow()
  })

  it('refuses an item too bulky for the slots', () => {
    expect(() => addItemToContainer('belt', 'quick', ItemSchema.parse({ name: 'Crate', bulk: 3 }))(characterWithBelt())).toThrow()
  })

  it('refuses a stack that would overflow the container', () => {
    const c = characterWithBelt()
    expect(() => addItemToContainer('belt', 'quick', ItemSchema.parse({ name: 'Bricks', bulk: 1, amount: 9 }))(c)).toThrow()
  })
})
