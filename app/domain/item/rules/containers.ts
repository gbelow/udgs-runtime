import { Character, Container, ContainerSchema, Item, SlotKind } from '../../types'
import { isSameItem } from './items'
import { getSize } from '../../character/rules/misc'
import containersCatalog from '../../../assets/containers.json'

export function getSlotBulk(container: Container, slot: SlotKind): number {
  return container.slots[slot].slotBulk
}

// gear.tex "Slot size and stacking": a slot holds one item of its bulk, 3 one
// step below, 10 two steps below, then on down the VM ladder: 30, 100, ...
export function getStackCapacity(slotBulk: number, itemBulk: number): number {
  const steps = slotBulk - itemBulk
  if (steps < 0) return 0
  return (steps % 2 === 0 ? 1 : 3) * 10 ** Math.floor(steps / 2)
}

// How many slots of the group a stack occupies, or null when the item can
// never go in that group whatever the free space. gear.tex "Quick slots":
// "can only carry 1 item each", so a stack there is one slot per unit.
export function getSlotsNeeded(container: Container, slot: SlotKind, item: Item): number | null {
  const slotBulk = getSlotBulk(container, slot)
  if (slot === 'quick') return item.bulk <= slotBulk ? item.amount : null
  const capacity = getStackCapacity(slotBulk, item.bulk)
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
// is already there, otherwise as a stack of its own.
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

// gear.tex "Containers and burden": "burden penalty = character size -
// container burden. If the number is negative, add it to the character's
// burden penalty." Penalties are stored as positive magnitudes and negated at
// the point of use, so this is the magnitude a container costs its bearer.
export function getContainerPenalty(c: Character, container: Container): number {
  return Math.max(0, container.burden - getSize(c))
}

// gear.tex "Containers and burden": "If the container's burden is 3 higher
// than the character, it causes the lame affliction."
export function isLamingContainer(c: Character, container: Container): boolean {
  return container.burden - getSize(c) >= 3
}

// Whoever has the container equipped bears it — a saddle burdens the horse
// it is equipped on, and the horse is a character like any other.
export function getBurdenPenalty(c: Character): number {
  return Object.values(c.containers).reduce(
    (total, container) => total + getContainerPenalty(c, container),
    0
  )
}

export function isLamedByBurden(c: Character): boolean {
  return Object.values(c.containers).some((container) => isLamingContainer(c, container))
}

// A catalog entry is a template with empty slots; equipping it stores a copy
// on the character, so the same key can be drawn any number of times.
export function getContainerCatalog(): Record<string, Container> {
  return Object.fromEntries(
    Object.entries(containersCatalog as Record<string, unknown>).map(([key, raw]) => [key, ContainerSchema.parse(raw)])
  )
}

export function getCatalogContainer(key: string): Container | undefined {
  const raw = (containersCatalog as Record<string, unknown>)[key]
  return raw ? ContainerSchema.parse(raw) : undefined
}
