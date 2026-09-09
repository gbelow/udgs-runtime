import { describe, it, expect } from 'vitest'
import { duplicateItem, addItemToContainer, removeItemFromContainer } from './items'
import { makeCharacter } from '../../factories'
import { ContainerSchema, ItemSchema } from '../../types'

function characterWithBelt() {
  return makeCharacter({
    containers: { belt: ContainerSchema.parse({ name: 'Belt', numSlots: 4, slotBulk: 1 }) },
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
    const after = removeItemFromContainer('belt', item.id)(addItemToContainer('belt', item)(before))
    expect(after.containers).toEqual(before.containers)
  })

  it('removes only the item named', () => {
    const kept = coin(1)
    const dropped = coin(2)
    const loaded = addItemToContainer('belt', dropped)(addItemToContainer('belt', kept)(characterWithBelt()))
    const after = removeItemFromContainer('belt', dropped.id)(loaded)
    expect(after.containers.belt.items.map((item) => item.id)).toEqual([kept.id])
  })
})

// Either the item goes in or nothing happens: a container that does not exist,
// or an item that does not fit, must not leave a half-loaded character behind.
describe('adding is all or nothing', () => {
  it('refuses a container that is not there', () => {
    expect(() => addItemToContainer('missing', coin())(characterWithBelt())).toThrow()
  })

  it('refuses an item too bulky for the slots', () => {
    expect(() => addItemToContainer('belt', ItemSchema.parse({ name: 'Crate', bulk: 3 }))(characterWithBelt())).toThrow()
  })

  it('refuses a stack that would overflow the container', () => {
    const c = characterWithBelt()
    expect(() => addItemToContainer('belt', ItemSchema.parse({ name: 'Bricks', bulk: 1, amount: 9 }))(c)).toThrow()
  })
})
