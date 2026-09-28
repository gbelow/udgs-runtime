import { describe, it, expect } from 'vitest'
import { equipContainer, putOnFromHands, takeOffContainer } from './containers'
import { makeCharacter } from '../../factories'
import { ContainerKindSchema, ContainerSchema, ItemSchema } from '../../types'
import type { Character, ContainerKind } from '../../types'

const kinds = ContainerKindSchema.options
const container = (name: string, kind: ContainerKind) => ContainerSchema.parse({ name, kind })

// gear.tex "Containers": "only one backpack, one bandolier and one belt at a
// time" — a body has one waist, one chest and one back. Saddles sit on
// animals and vehicles are pulled, so nothing limits them.
const WORN: ContainerKind[] = ['belt', 'bandolier', 'backpack']

function carrying(): Character {
  return {
    ...makeCharacter(null),
    containers: {
      belt: container('Belt', 'belt'),
      sash: container('Bandolier', 'bandolier'),
      pack: container('Backpack', 'backpack'),
      saddle: container('Saddle', 'saddle'),
      sled: container('Sled', 'vehicle'),
      cart: container('Cart', 'vehicle'),
    },
  }
}

const countOf = (c: Character, kind: ContainerKind) =>
  Object.values(c.containers).filter((container) => container.kind === kind).length

// The rule is stated over kinds, so it is checked over kinds.
describe('equipContainer', () => {
  it.each(kinds)('equipping a %s leaves at most one of each worn kind', (kind) => {
    const after = equipContainer('new', container('New', kind))(carrying())
    for (const worn of WORN) expect(countOf(after, worn)).toBeLessThanOrEqual(1)
    expect(after.containers.new.name).toBe('New')
  })

  it.each(kinds)('equipping a %s keeps every container of another kind', (kind) => {
    const before = carrying()
    const after = equipContainer('new', container('New', kind))(before)
    for (const other of kinds) {
      if (other === kind) continue
      expect(countOf(after, other)).toBe(countOf(before, other))
    }
  })

  it.each(kinds.filter((kind) => !WORN.includes(kind)))('does not limit how many %ss are hauled', (kind) => {
    const before = carrying()
    const after = equipContainer('another', container('Another', kind))(before)
    expect(countOf(after, kind)).toBe(countOf(before, kind) + 1)
  })
})

// A container taken off is in the hands with what it carries, so putting it
// back on from there leaves the character wearing what they wore. A quiver
// is slung, never put on.
describe('takeOffContainer', () => {
  it.each(kinds.filter((kind) => kind !== 'quiver'))('is undone by putting the %s back on', (kind) => {
    const stowed = ItemSchema.parse({ name: 'Rope', bulk: 1 })
    const before = { ...makeCharacter(null), containers: { New: { ...container('New', kind), slots: { ...container('New', kind).slots, large: { numSlots: 1, slotBulk: 3, items: [stowed] } } } } }
    const off = takeOffContainer('New')(before)
    const after = putOnFromHands(off.held[0].id)(off)
    expect(after.containers).toEqual(before.containers)
    expect(after.held).toEqual(before.held)
  })
})
