import type { Character, Container, ContainerKind, Item, SlotKind } from '../../types'
import { SlotKindSchema } from '../../types'
import { getWearView, WearView } from '../../character/rules/armor'
import { getBulkName } from '../rules/items'
import { getStoreCost, isCharged } from '../rules/costs'
import { getHeldItem } from '../rules/hands'
import {
  canFitItem,
  getAvailableSlots,
  getBurdenPenalty,
  getContainerCatalog,
  getContainerPenalty,
  getSlotBulk,
  getSlotsNeeded,
  getUsedSlots,
  isLamedByBurden,
  isLamingContainer,
} from '../rules/containers'
import { getDrawView } from './hands'

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
