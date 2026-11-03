import type { Character, Item } from '../../types'
import type { Body, FloorItem, LootSource } from '../types'
import { mapSlotGroups } from '../../item/rules/containers'
import { removeItemFromContainer } from '../../item/commands/items'
import { dropItem } from '../../item/commands/hands'
import { without } from '../../utils'

// One unit of the stack leaves, the stack itself when it is the last.
const oneOut = (items: Item[], itemId: string): Item[] =>
  items.flatMap((i) => (i.id !== itemId ? [i] : i.amount > 1 ? [{ ...i, amount: i.amount - 1 }] : []))

// One of the item taken out of a container lying on the floor.
export function takeFromChest(floor: FloorItem[], chestId: string, itemId: string): FloorItem[] {
  return floor.map((f) => (f.item.id === chestId && f.item.container
    ? { ...f, item: { ...f.item, container: mapSlotGroups(f.item.container, (group) => ({ ...group, items: oneOut(group.items, itemId) })) } }
    : f))
}

// One of the item taken from whoever has it: out of their hands or off their
// back, out of a container they wear, or the armor or a container they wear
// itself. A hand holds one of a stack, never the stack.
export function takeFromCarrier<C extends Character>(c: C, from: Exclude<LootSource, { kind: 'floor' | 'chest' }>, itemId: string): C {
  if (from.kind === 'pack') return removeItemFromContainer(from.container, itemId, 1)(c)
  if (from.kind === 'worn') return { ...c, worn: null }
  if (from.kind === 'wornPack') return { ...c, containers: without(c.containers, from.container) }
  return c.onBack?.id === itemId ? { ...c, onBack: null } : dropItem(itemId)(c)
}

// The same off a body.
export function takeFromBody(bodies: Body[], from: Exclude<LootSource, { kind: 'floor' | 'chest' }>, itemId: string): Body[] {
  return bodies.map((b) => (b.character.id === from.body ? { ...b, character: takeFromCarrier(b.character, from, itemId) } : b))
}
