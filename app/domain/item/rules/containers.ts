import { Character, Container, ContainerKind, Item, ItemSchema, SlotKind } from '../../types'
import { isSameItem } from './items'
import { FREE, MoveView, getDrawCost, isCharged } from './costs'
import { getSize } from '../../character/rules/misc'

// gear.tex "Quiver": "Can be slung on a belt" — a quiver in a quick slot of
// a container the character has on is one more container to them, named by
// the quiver's own id.
export function getSlungContainers(c: Character): Record<string, Container> {
  return Object.fromEntries(
    Object.values(c.containers).flatMap((container) =>
      container.slots.quick.items.flatMap((item) => (item.container?.kind === 'quiver' ? [[item.id, item.container]] : [])))
  )
}

// Every container the character can put things into and take them out of:
// the ones they have on, and the quivers slung on those.
export function getOpenContainers(c: Character): Record<string, Container> {
  return { ...c.containers, ...getSlungContainers(c) }
}

export function getContainer(c: Character, key: string): Container | undefined {
  return getOpenContainers(c)[key]
}

// What the character has at hand: what is in their hands and in the quick
// slots of their open containers — where a spell's gear has to be to cast it.
export function getReadyItems(c: Character): Item[] {
  return [...c.held, ...Object.values(getOpenContainers(c)).flatMap((container) => container.slots.quick.items)]
}

// Where a ready item sits: in the hands, or the quick slots of the container
// under that key.
export function findReadyItem(c: Character, itemId: string): { item: Item; containerKey: string | null } | null {
  const held = c.held.find((i) => i.id === itemId)
  if (held) return { item: held, containerKey: null }
  for (const [containerKey, container] of Object.entries(getOpenContainers(c))) {
    const item = container.slots.quick.items.find((i) => i.id === itemId)
    if (item) return { item, containerKey }
  }
  return null
}

// gear.tex "Containers": "A character can use only one backpack, one
// bandolier and one belt at a time". Saddles and vehicles aren't limited.
export const WORN_ONE_AT_A_TIME: ReadonlySet<ContainerKind> = new Set(['belt', 'bandolier', 'backpack'])

// A container put on is filed under the catalog row it was stamped from, and
// taken off it is that row's item again, with what it carries.
export function getContainerKey(item: Item): string {
  return item.refId || item.name
}

export function getContainerItem(key: string, container: Container): Item {
  return ItemSchema.parse({ name: container.name, type: 'container', refId: key, bulk: container.bulk, container })
}

// The container already on that putting this one on would displace: one
// filed under the same row, or one of a kind worn one at a time.
export function getDisplacedContainer(c: Character, item: Item): Container | undefined {
  const kind = item.container?.kind
  const key = getContainerKey(item)
  return Object.entries(c.containers).find(([k, on]) => k === key || (kind !== undefined && WORN_ONE_AT_A_TIME.has(kind) && on.kind === kind))?.[1]
}

// Whether a container item can be put on from where it is — the catalog
// (null), the hands, or a slot — and what it costs a character in play: a
// slot's draw price (combat.tex "Drawing items in combat"), from the hands
// nothing. Only a catalog pick on the sheet goes over whatever it displaces,
// which is how a character is dressed; anywhere else the other comes off
// first. A quiver is not put on but slung (gear.tex "Quiver"). Null for an
// item that is not a container one can put on.
export function getPutOnView(c: Character, from: SlotKind | 'hand' | null, item: Item): MoveView | null {
  if (!item.container || item.container.kind === 'quiver') return null
  const displaced = getDisplacedContainer(c, item)
  if (displaced && (from !== null || isCharged(c))) return { able: false, cost: null, why: `take off the ${displaced.name} first` }
  if (!isCharged(c)) return { able: true, cost: null, why: '' }
  const cost = from === null || from === 'hand' ? FREE : getDrawCost(c, from, item)
  return { able: true, cost: cost.AP, why: '' }
}

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

