import { describe, it, expect } from 'vitest'
import {
  getStackCapacity, getUsedSlots, getAvailableSlots, canFitItem,
  getContainerPenalty, getBurdenPenalty, getBurdenLevel,
} from './containers'
import { addItemToContainer } from '../commands/items'
import { makeCharacter } from '../../factories'
import { ContainerSchema, ItemSchema } from '../../types'
import type { Container, Item } from '../../types'

const bulks = [0, 1, 2, 3, 4]

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
    ['empty belt', ContainerSchema.parse({ numSlots: 4, slotBulk: 1 })],
    ['personal', ContainerSchema.parse({
      numSlots: 10, slotBulk: 2,
      items: [ItemSchema.parse({ bulk: 0, amount: 25 }), ItemSchema.parse({ bulk: 1, amount: 6 })],
    })],
    ['cargo', ContainerSchema.parse({
      numSlots: 200, slotBulk: 3, items: [ItemSchema.parse({ bulk: 3, amount: 40 })],
    })],
  ]

  it.each(containers)('used and available split the slots of a %s container', (_label, container) => {
    expect(getUsedSlots(container) + getAvailableSlots(container)).toBe(container.numSlots)
  })

  // Each item is charged on its own, so the cost of a load is the cost of its
  // parts — no packing cleverness that a caller could not predict.
  it.each(containers)('charges a %s container per item', (_label, container) => {
    const perItem = container.items.reduce(
      (total, item) => total + getUsedSlots({ ...container, items: [item] }),
      0,
    )
    expect(getUsedSlots(container)).toBe(perItem)
  })
})

// The lens answers whether an item fits and the command refuses one that does
// not. They are two readings of the same question, so they have to give the
// same answer for every shape of container and item.
describe('canFitItem agrees with addItemToContainer', () => {
  const container = (slotBulk: number, numSlots: number) =>
    ContainerSchema.parse({ name: 'Test', slotBulk, numSlots })
  const item = (bulk: number, amount: number) => ItemSchema.parse({ name: 'Thing', bulk, amount })

  const cases: [Container, Item][] = []
  for (const slotBulk of [0, 1, 2, 3]) {
    for (const numSlots of [0, 1, 2, 5]) {
      for (const bulk of [0, 1, 2, 3]) {
        for (const amount of [1, 3, 6, 30]) cases.push([container(slotBulk, numSlots), item(bulk, amount)])
      }
    }
  }

  it('accepts exactly what the command accepts', () => {
    const disagreements = cases.filter(([box, thing]) => {
      const c = { ...makeCharacter(null), containers: { box } }
      let accepted = true
      try {
        addItemToContainer('box', thing)(c)
      } catch {
        accepted = false
      }
      return accepted !== canFitItem(box, thing)
    })
    expect(disagreements).toEqual([])
  })
})

// gear.tex "Containers and burden": a container's penalty can be reduced by
// being strong or large enough for it, and burden is only ever a cost.
describe('getContainerPenalty', () => {
  const heavy = ContainerSchema.parse({
    name: 'Large Backpack', penalty: 2, liftThreshold: { STR: 15, size: 4 },
  })
  const light = ContainerSchema.parse({ name: 'Belt', penalty: 0 })
  const character = (STR: number, size: number) =>
    makeCharacter({ trainables: { STR: { value: STR } }, size })

  it.each([heavy, light])('stays between 0 and the printed penalty', (container) => {
    for (const STR of [1, 10, 15, 30]) {
      for (const size of [1, 3, 4, 7]) {
        const penalty = getContainerPenalty(character(STR, size), container)
        expect(penalty).toBeGreaterThanOrEqual(0)
        expect(penalty).toBeLessThanOrEqual(container.penalty)
      }
    }
  })

  it('leaves a container with no threshold alone however strong the carrier', () => {
    const printed = ContainerSchema.parse({ name: 'Sack', penalty: 2 })
    expect(getContainerPenalty(character(30, 7), printed)).toBe(printed.penalty)
  })
})

describe('getBurdenPenalty', () => {
  const carrying = (containers: Record<string, Container>) => ({
    ...makeCharacter({ trainables: { STR: { value: 10 } }, size: 3 }),
    containers,
  })
  const belt = ContainerSchema.parse({ name: 'Belt', penalty: 0 })
  const pack = ContainerSchema.parse({ name: 'Backpack', penalty: 1 })
  const sled = ContainerSchema.parse({ name: 'Sled', penalty: 3 })

  it('is nothing for a character carrying nothing', () => {
    expect(getBurdenPenalty(carrying({}))).toBe(0)
  })

  // Burden adds up: what a character carries costs the sum of its pieces, so
  // no container can hide inside another one's total.
  it('is the sum of what is carried', () => {
    const all = { belt, pack, sled }
    const parts = Object.entries(all).reduce(
      (total, [key, container]) => total + getBurdenPenalty(carrying({ [key]: container })),
      0,
    )
    expect(getBurdenPenalty(carrying(all))).toBe(parts)
  })
})

describe('getBurdenLevel', () => {
  it('names a level for any penalty, sane or not', () => {
    const levels = ['light', 'medium', 'heavy', 'over']
    for (let penalty = -5; penalty <= 20; penalty++) {
      expect(levels).toContain(getBurdenLevel(penalty))
    }
  })
})
