import { Character, Container, ContainerKind, ContainerSchema, Item, SlotKind, SlotKindSchema } from '../../types'
import { getBulkName, isSameItem } from './items'
import { getDrawView, getHeldItem, getStoreCost, isCharged } from './hands'
import { getWearView, WearView } from '../../character/lenses/armor'
import { getSize } from '../../character/lenses/misc'
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

export type ContainerItemView = {
  id: string
  name: string
  amount: number
  bulk: number
  bulkName: string
  slots: number
  // Whether a unit could be drawn into the hands, and its AP for a character
  // in play (null on the sheet, where nothing is charged).
  drawable: boolean
  drawCost: number | null
  // For an armor item, whether it could be put on from here; null otherwise.
  wear: WearView | null
}

// One slot group as the Containers table prints it: the Quick column names the
// bulk its slots take, the other two are their own bulk. `fits` answers for
// the item being placed, and is null when nothing is; `storeCost` is what a
// character in play pays to put it there when it comes out of the hands.
export type ContainerSlotView = {
  slot: SlotKind
  bulkName: string
  numSlots: number
  used: number
  available: number
  fits: boolean | null
  storeCost: number | null
  items: ContainerItemView[]
}

// `burden` is the container's own step; `penalty` is what it costs the
// character bearing it, and null on a catalog row that nobody bears yet.
export type ContainerPanelView = {
  key: string
  name: string
  kind: ContainerKind
  burden: number
  penalty: { value: number; lame: boolean } | null
  slots: ContainerSlotView[]
}

export type BurdenView = {
  penalty: number
  lame: boolean
  label: string
}

// A pending stack that is already on the character — in the hands or on the
// back — pays to be put away; a catalog pick appears in the slot for nothing.
function getContainerPanel(key: string, container: Container, pending?: Item, c?: Character): ContainerPanelView {
  const fromHands = c && pending && (getHeldItem(c, pending.id) || c.worn?.id === pending.id) ? pending : undefined
  return {
    key,
    name: container.name,
    kind: container.kind,
    burden: container.burden,
    penalty: c ? { value: getContainerPenalty(c, container), lame: isLamingContainer(c, container) } : null,
    slots: SlotKindSchema.options
      .filter((slot) => container.slots[slot].numSlots > 0)
      .map((slot) => ({
        slot,
        bulkName: getBulkName(getSlotBulk(container, slot)),
        numSlots: container.slots[slot].numSlots,
        used: getUsedSlots(container, slot),
        available: getAvailableSlots(container, slot),
        fits: pending ? canFitItem(container, slot, pending) : null,
        storeCost: c && fromHands && isCharged(c) ? getStoreCost(c, slot, fromHands).AP : null,
        items: container.slots[slot].items.map((item) => ({
          id: item.id,
          name: item.name || item.refId,
          amount: item.amount,
          bulk: item.bulk,
          bulkName: getBulkName(item.bulk),
          slots: getSlotsNeeded(container, slot, item) ?? item.amount,
          ...(c ? getDrawView(c, slot, item) : { drawable: false, drawCost: null }),
          wear: c ? getWearView(c, slot, item) : null,
        })),
      })),
  }
}

// The whole container panel in one shape: every equipped container, its slot
// groups and the stacks in each, with nothing left for the UI to count. With
// an item pending placement, each group also says whether it would take it.
export function getContainerPanels(c: Character, pending?: Item): ContainerPanelView[] {
  return Object.entries(c.containers).map(([key, container]) => getContainerPanel(key, container, pending, c))
}

// The catalog in the same shape, so a sidebar row and an equipped card render
// the same view.
export function getContainerCatalogPanels(): ContainerPanelView[] {
  return Object.entries(getContainerCatalog()).map(([key, container]) => getContainerPanel(key, container))
}

// gear.tex "Containers and burden": what the containers alone cost the
// character. The penalty is a magnitude; the label prints it the way the book
// does, as the modifier it becomes.
export function getBurden(c: Character): BurdenView {
  const penalty = getBurdenPenalty(c)
  const lame = isLamedByBurden(c)
  const label = penalty > 0 ? `-${penalty}` : 'none'
  return { penalty, lame, label: lame ? `${label} (lame)` : label }
}
