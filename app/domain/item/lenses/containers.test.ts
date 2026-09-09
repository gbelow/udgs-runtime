import { describe, it, expect } from 'vitest'
import { getStackCapacity, getUsedSlots, getAvailableSlots, canFitItem, getContainerPenalty } from './containers'
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
// being strong or large enough for it, and burden is only ever a cost — the
// domain reports penalties as positive magnitudes throughout.
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
})
