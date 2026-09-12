import { describe, it, expect } from 'vitest'
import { getStackCapacity, getUsedSlots, getAvailableSlots, canFitItem } from './containers'
import { addItemToContainer } from '../commands/items'
import { makeCharacter } from '../../factories'
import { ContainerKindSchema, ContainerSchema, ItemSchema, SlotKindSchema } from '../../types'
import type { Container, Item, SlotKind } from '../../types'

const bulks = [0, 1, 2, 3, 4]
const slotKinds = SlotKindSchema.options

// A slot holds one item of its own bulk and five times as many of each bulk
// below it. The ladder is the rule; these are the properties it has to keep
// whatever the ratio is.
describe('getStackCapacity', () => {
  it.each(bulks)('holds exactly one item of its own bulk at slot bulk %i', (bulk) => {
    expect(getStackCapacity(bulk, bulk)).toBe(1)
  })

  it.each(bulks)('holds nothing bulkier than slot bulk %i', (slotBulk) => {
    for (const itemBulk of bulks) {
      if (itemBulk > slotBulk) expect(getStackCapacity(slotBulk, itemBulk)).toBe(0)
      else expect(getStackCapacity(slotBulk, itemBulk)).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('slot accounting', () => {
  const containers: [string, Container][] = [
    ['empty belt', ContainerSchema.parse({ kind: 'belt', slots: { quick: { numSlots: 4, slotBulk: 1 } } })],
    ['personal', ContainerSchema.parse({
      kind: 'backpack',
      slots: {
        medium: { numSlots: 12, items: [ItemSchema.parse({ bulk: 0, amount: 25 }), ItemSchema.parse({ bulk: 1, amount: 6 })] },
        large: { numSlots: 2, items: [ItemSchema.parse({ bulk: 1, amount: 6 })] },
      },
    })],
    ['cargo', ContainerSchema.parse({
      kind: 'vehicle', slots: { large: { numSlots: 100, items: [ItemSchema.parse({ bulk: 3, amount: 40 })] } },
    })],
  ]

  it.each(containers)('used and available split the slots of a %s container', (_label, container) => {
    for (const slot of slotKinds) {
      expect(getUsedSlots(container, slot) + getAvailableSlots(container, slot)).toBe(container.slots[slot].numSlots)
    }
  })
})

// The lens answers whether an item fits and the command refuses one that does
// not. They are two readings of the same question, so they have to give the
// same answer for every shape of container, slot group and item.
describe('canFitItem agrees with addItemToContainer', () => {
  const item = (bulk: number, amount: number) => ItemSchema.parse({ name: 'Thing', bulk, amount })

  const cases: [Container, SlotKind, Item][] = []
  for (const kind of ContainerKindSchema.options) {
    for (const slotBulk of [0, 1, 2]) {
      for (const numSlots of [0, 1, 2, 5]) {
        const box = ContainerSchema.parse({
          name: 'Test', kind,
          slots: { quick: { numSlots, slotBulk }, medium: { numSlots }, large: { numSlots } },
        })
        for (const slot of slotKinds) {
          for (const bulk of [0, 1, 2, 3]) {
            for (const amount of [1, 3, 6, 30]) cases.push([box, slot, item(bulk, amount)])
          }
        }
      }
    }
  }

  it('accepts exactly what the command accepts', () => {
    const disagreements = cases.filter(([box, slot, thing]) => {
      const c = { ...makeCharacter(null), containers: { box } }
      let accepted = true
      try {
        addItemToContainer('box', slot, thing)(c)
      } catch {
        accepted = false
      }
      return accepted !== canFitItem(box, slot, thing)
    })
    expect(disagreements).toEqual([])
  })
})
