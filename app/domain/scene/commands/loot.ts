import type { Item } from '../../types'
import type { Body, FloorItem, LootSource } from '../types'
import { mapSlotGroups } from '../../item/rules/containers'
import { removeItemFromContainer } from '../../item/commands/items'
import { dropItem } from '../../item/commands/hands'

// One unit of the stack leaves, the stack itself when it is the last.
const oneOut = (items: Item[], itemId: string): Item[] =>
  items.flatMap((i) => (i.id !== itemId ? [i] : i.amount > 1 ? [{ ...i, amount: i.amount - 1 }] : []))

// One of the item taken out of a container lying on the floor.
export function takeFromChest(floor: FloorItem[], chestId: string, itemId: string): FloorItem[] {
  return floor.map((f) => (f.item.id === chestId && f.item.container
    ? { ...f, item: { ...f.item, container: mapSlotGroups(f.item.container, (group) => ({ ...group, items: oneOut(group.items, itemId) })) } }
    : f))
}

// One of the item taken from a body: out of its hands or off its back, or
// out of a container it wears. A hand holds one of a stack, never the stack.
export function takeFromBody(bodies: Body[], from: Extract<LootSource, { kind: 'body' | 'pack' }>, itemId: string): Body[] {
  return bodies.map((b) => {
    const c = b.character
    if (c.id !== from.body) return b
    if (from.kind === 'pack') return { ...b, character: removeItemFromContainer(from.container, itemId, 1)(c) }
    return { ...b, character: c.onBack?.id === itemId ? { ...c, onBack: null } : dropItem(itemId)(c) }
  })
}
