import { describe, it, expect } from 'vitest'
import { equipContainer, unequipContainer } from './containers'
import { makeCharacter } from '../../factories'
import { ContainerKindSchema, ContainerSchema } from '../../types'
import type { Character, ContainerKind } from '../../types'

const kinds = ContainerKindSchema.options
const container = (name: string, kind: ContainerKind) => ContainerSchema.parse({ name, kind })

function carrying(): Character {
  return {
    ...makeCharacter(null),
    containers: {
      belt: container('Belt', 'belt'),
      pack: container('Backpack', 'backpack'),
      sled: container('Sled', 'transport'),
      cart: container('Cart', 'transport'),
    },
  }
}

const countOf = (c: Character, kind: ContainerKind) =>
  Object.values(c.containers).filter((container) => container.kind === kind).length

// "Only one belt and one backpack at a time" — a body has one waist and one
// back. Transports are pulled rather than worn, so nothing limits them. The
// rule is stated over kinds, so it is checked over kinds.
describe('equipContainer', () => {
  it.each(kinds)('equipping a %s leaves at most one belt and one backpack', (kind) => {
    const after = equipContainer('new', container('New', kind))(carrying())
    expect(countOf(after, 'belt')).toBeLessThanOrEqual(1)
    expect(countOf(after, 'backpack')).toBeLessThanOrEqual(1)
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

  it('does not limit how many transports are hauled', () => {
    const after = equipContainer('barrow', container('Wheelbarrow', 'transport'))(carrying())
    expect(countOf(after, 'transport')).toBe(3)
  })
})

describe('unequipContainer', () => {
  // Only from a character not already wearing that kind: equipping a belt or a
  // backpack evicts the one it replaces, and unequipping cannot bring it back.
  it.each(kinds)('undoes equipping a %s', (kind) => {
    const before = makeCharacter(null)
    const after = unequipContainer('new')(equipContainer('new', container('New', kind))(before))
    expect(after.containers).toEqual(before.containers)
  })
})
