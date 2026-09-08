import { describe, it, expect } from 'vitest'
import { getStackCapacity, getUsedSlots, getAvailableSlots, canFitItem, getContainerPenalty, getBurdenPenalty, getBurdenLevel } from './containers'
import { makeCharacter } from '../../factories'
import { ContainerSchema, ItemSchema } from '../../types'

function character(overrides: Parameters<typeof makeCharacter>[0] = {}) {
  return makeCharacter(overrides)
}

describe('getStackCapacity', () => {
  it('matches the containers.md stacking table for a large slot', () => {
    expect(getStackCapacity(2, 2)).toBe(1)  // 1 large
    expect(getStackCapacity(2, 1)).toBe(5)  // 5 medium
    expect(getStackCapacity(2, 0)).toBe(25) // 25 small
  })

  it('matches the table for a medium slot', () => {
    expect(getStackCapacity(1, 1)).toBe(1)
    expect(getStackCapacity(1, 0)).toBe(5)
  })

  it('matches the table for a small slot', () => {
    expect(getStackCapacity(0, 0)).toBe(1)
  })

  it('is 0 when the item is bulkier than the slot', () => {
    expect(getStackCapacity(0, 1)).toBe(0)
    expect(getStackCapacity(1, 2)).toBe(0)
  })
})

describe('getUsedSlots / getAvailableSlots', () => {
  it('sums stacks by capacity for a personal container', () => {
    const container = ContainerSchema.parse({
      numSlots: 10,
      slotBulk: 2,
      items: [
        ItemSchema.parse({ bulk: 0, amount: 25 }), // 1 slot
        ItemSchema.parse({ bulk: 1, amount: 6 }),  // ceil(6/5) = 2 slots
      ],
    })
    expect(getUsedSlots(container)).toBe(3)
    expect(getAvailableSlots(container)).toBe(7)
  })

  it('sums raw amount for a cargo container', () => {
    const container = ContainerSchema.parse({
      numSlots: 200,
      slotBulk: 3,
      items: [ItemSchema.parse({ bulk: 3, amount: 40 })],
    })
    expect(getUsedSlots(container)).toBe(40)
  })
})

describe('canFitItem', () => {
  const container = ContainerSchema.parse({ numSlots: 2, slotBulk: 1, items: [] })

  it('accepts an item that fits within capacity', () => {
    expect(canFitItem(container, ItemSchema.parse({ bulk: 1, amount: 2 }))).toBe(true)
  })

  it('rejects an item bulkier than the slot', () => {
    expect(canFitItem(container, ItemSchema.parse({ bulk: 2, amount: 1 }))).toBe(false)
  })

  it('rejects an item that would overflow available slots', () => {
    expect(canFitItem(container, ItemSchema.parse({ bulk: 1, amount: 3 }))).toBe(false)
  })
})

describe('getContainerPenalty', () => {
  const largeBackpack = ContainerSchema.parse({
    name: 'Large Backpack',
    penalty: 2,
    liftThreshold: { STR: 15, size: 4 },
  })

  it('applies the flat penalty when the threshold is not met', () => {
    const c = character({ trainables: { STR: { value: 10 } }, size: 3 })
    expect(getContainerPenalty(c, largeBackpack)).toBe(2)
  })

  it('reduces the penalty by one level when STR meets the threshold', () => {
    const c = character({ trainables: { STR: { value: 15 } }, size: 3 })
    expect(getContainerPenalty(c, largeBackpack)).toBe(1)
  })

  it('reduces the penalty by one level when size meets the threshold', () => {
    const c = character({ trainables: { STR: { value: 10 } }, size: 4 })
    expect(getContainerPenalty(c, largeBackpack)).toBe(1)
  })

  it('leaves containers with no liftThreshold untouched', () => {
    const belt = ContainerSchema.parse({ name: 'Belt', penalty: 0 })
    const c = character({ trainables: { STR: { value: 20 } }, size: 7 })
    expect(getContainerPenalty(c, belt)).toBe(0)
  })
})

describe('getBurdenPenalty / getBurdenLevel', () => {
  it('sums penalty across all equipped containers', () => {
    const c = character({
      trainables: { STR: { value: 10 } },
      size: 3,
      containers: {
        belt: ContainerSchema.parse({ name: 'Belt', penalty: 0 }),
        backpack: ContainerSchema.parse({ name: 'Backpack', penalty: 1 }),
      },
    })
    expect(getBurdenPenalty(c)).toBe(1)
    expect(getBurdenLevel(getBurdenPenalty(c))).toBe('medium')
  })

  it('maps penalty levels to labels', () => {
    expect(getBurdenLevel(0)).toBe('light')
    expect(getBurdenLevel(1)).toBe('medium')
    expect(getBurdenLevel(2)).toBe('heavy')
    expect(getBurdenLevel(3)).toBe('over')
  })
})
