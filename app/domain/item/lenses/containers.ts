import { Character, Container, Item, SlotKind } from '../../types'
import { isSameItem } from './items'

// gear.tex "Slot size and stacking": medium and large slots take their own
// bulk; a quick slot takes whatever bulk the container's Quick column prints.
export function getSlotBulk(container: Container, slot: SlotKind): number {
  if (slot === 'quick') return container.slots.quick.slotBulk
  return slot === 'medium' ? 1 : 2
}

// slots holds 5^(slotBulk - itemBulk): 1 same-bulk item, 5 of the next bulk down, 25 two bulks down
export function getStackCapacity(slotBulk: number, itemBulk: number): number {
  if (itemBulk > slotBulk) return 0
  return 5 ** (slotBulk - itemBulk)
}

// gear.tex "Containers and Burden": cargo is counted in large items and can
// only be placed in vehicles, so it never stacks and never rides on a body.
const isCargo = (item: Item) => item.bulk >= 3

// How many slots of the group a stack occupies, or null when the item can
// never go in that group whatever the free space.
export function getSlotsNeeded(container: Container, slot: SlotKind, item: Item): number | null {
  if (isCargo(item)) return container.kind === 'vehicle' && slot === 'large' ? item.amount : null
  const capacity = getStackCapacity(getSlotBulk(container, slot), item.bulk)
  return capacity > 0 ? Math.ceil(item.amount / capacity) : null
}

export function getUsedSlots(container: Container, slot: SlotKind): number {
  return container.slots[slot].items.reduce(
    (total, item) => total + (getSlotsNeeded(container, slot, item) ?? item.amount),
    0
  )
}

export function getAvailableSlots(container: Container, slot: SlotKind): number {
  return container.slots[slot].numSlots - getUsedSlots(container, slot)
}

// The group as it would be with the item added: onto an identical stack that
// is already there, otherwise as a stack of its own. Cargo is a measure, not
// a count of units, but it merges the same way — two loads of the same cargo
// are one bigger load.
export function stackInto(items: Item[], item: Item): Item[] {
  const at = items.findIndex((other) => isSameItem(other, item))
  if (at < 0) return [...items, item]
  const merged = { ...items[at], amount: items[at].amount + item.amount }
  return items.map((other, i) => (i === at ? merged : other))
}

export function canFitItem(container: Container, slot: SlotKind, item: Item): boolean {
  if (getSlotsNeeded(container, slot, item) === null) return false
  const group = container.slots[slot]
  const loaded = { ...container, slots: { ...container.slots, [slot]: { ...group, items: stackInto(group.items, item) } } }
  return getUsedSlots(loaded, slot) <= group.numSlots
}

// Whoever has the container equipped bears it — a saddle burdens the horse
// it is equipped on, and the horse is a character like any other.
export function getBurdenPenalty(character: Character): number {
  return Object.values(character.containers).reduce(
    (total, container) => total + container.penalty,
    0
  )
}

// gear.tex "Containers and burden": light has no effect, then -1 / -2 / -3.
// Penalties are stored as positive magnitudes and negated at the point of use.
export function getBurdenLevel(penalty: number): 'light' | 'medium' | 'heavy' | 'over' {
  if (penalty <= 0) return 'light'
  if (penalty === 1) return 'medium'
  if (penalty === 2) return 'heavy'
  return 'over'
}
