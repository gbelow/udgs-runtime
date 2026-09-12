import { Character, Container, ContainerKind, ContainerSchema, Item, SlotKind, SlotKindSchema } from '../../types'
import { getBulkName, isSameItem } from './items'
import containersCatalog from '../../../assets/containers.json'

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

export type BurdenLevel = ReturnType<typeof getBurdenLevel>

export type ContainerItemView = {
  id: string
  name: string
  amount: number
  bulk: number
  bulkName: string
  slots: number
}

// One slot group as the Containers table prints it: the Quick column names the
// bulk its slots take, the other two are their own bulk. `fits` answers for
// the item being placed, and is null when nothing is.
export type ContainerSlotView = {
  slot: SlotKind
  bulkName: string
  numSlots: number
  used: number
  available: number
  fits: boolean | null
  items: ContainerItemView[]
}

export type ContainerPanelView = {
  key: string
  name: string
  kind: ContainerKind
  penalty: number
  burden: BurdenLevel
  slots: ContainerSlotView[]
}

export type BurdenView = {
  penalty: number
  level: BurdenLevel
  label: string
}

function getContainerPanel(key: string, container: Container, pending?: Item): ContainerPanelView {
  return {
    key,
    name: container.name,
    kind: container.kind,
    penalty: container.penalty,
    burden: getBurdenLevel(container.penalty),
    slots: SlotKindSchema.options
      .filter((slot) => container.slots[slot].numSlots > 0)
      .map((slot) => ({
        slot,
        bulkName: getBulkName(getSlotBulk(container, slot)),
        numSlots: container.slots[slot].numSlots,
        used: getUsedSlots(container, slot),
        available: getAvailableSlots(container, slot),
        fits: pending ? canFitItem(container, slot, pending) : null,
        items: container.slots[slot].items.map((item) => ({
          id: item.id,
          name: item.name || item.refId,
          amount: item.amount,
          bulk: item.bulk,
          bulkName: getBulkName(item.bulk),
          slots: getSlotsNeeded(container, slot, item) ?? item.amount,
        })),
      })),
  }
}

// The whole container panel in one shape: every equipped container, its slot
// groups and the stacks in each, with nothing left for the UI to count. With
// an item pending placement, each group also says whether it would take it.
export function getContainerPanels(c: Character, pending?: Item): ContainerPanelView[] {
  return Object.entries(c.containers).map(([key, container]) => getContainerPanel(key, container, pending))
}

// The catalog in the same shape, so a sidebar row and an equipped card render
// the same view.
export function getContainerCatalogPanels(): ContainerPanelView[] {
  return Object.entries(getContainerCatalog()).map(([key, container]) => getContainerPanel(key, container))
}

// gear.tex "Containers and burden": the level a character is at from the
// containers alone. The penalty is a stored magnitude; the label prints it the
// way the book does, as the modifier it becomes.
export function getBurden(c: Character): BurdenView {
  const penalty = getBurdenPenalty(c)
  const level = getBurdenLevel(penalty)
  return { penalty, level, label: penalty > 0 ? `${level} (-${penalty})` : level }
}
