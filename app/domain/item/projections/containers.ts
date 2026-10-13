import type { Character, Container, ContainerKind, Item, SlotKind } from '../../types'
import { SlotKindSchema } from '../../types'
import { getWearView, WearView } from '../../character/rules/donning'
import { getBulkName, getContents } from '../rules/items'
import { MoveView, getPutOnView, getStoreCost, isCharged } from '../rules/costs'
import { getHeldItem } from '../rules/hands'
import {
  canFitItem,
  getAvailableSlots,
  getBurdenPenalty,
  getContainerPenalty,
  getOpenContainers,
  getInnerContainers,
  OPENS_IN,
  getSlotBulk,
  getSlotsNeeded,
  getUsedSlots,
  isLamedByBurden,
  isLamingContainer,
} from '../rules/containers'
import { getDrawView } from './hands'
import { getMoneyValue } from '../rules/money'
import { isOfferable } from '../rules/trade'
import { formatMoney } from '../rules/money'

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
  // For a container item, the same.
  putOn: MoveView | null
  // Whether it can be put down in a trade.
  offerable: boolean
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
  // where it is opened when that is a slot of another container rather than
  // being put on ("slung"); it then comes off the way any item in a slot does
  inner: string | null
  burden: number
  penalty: { value: number; lame: boolean } | null
  // the currency lying in its own slots, written in coins; null for none
  money: string | null
  slots: ContainerSlotView[]
}

export type BurdenView = {
  penalty: number
  lame: boolean
  label: string
}

// A pending stack that is already on the character — in the hands or on the
// back — pays to be put away; a catalog pick appears in the slot for nothing.
function getContainerPanel(key: string, container: Container, charged: boolean, pending?: Item, c?: Character): ContainerPanelView {
  const fromHands = c && pending && (getHeldItem(c, pending.id) || c.worn?.id === pending.id) ? pending : undefined
  return {
    key,
    name: container.name,
    kind: container.kind,
    inner: c && key in getInnerContainers(c) ? (OPENS_IN[container.kind]?.where ?? null) : null,
    burden: container.burden,
    penalty: c ? { value: getContainerPenalty(c, container), lame: isLamingContainer(c, container) } : null,
    money: getContainerMoney(container),
    slots: SlotKindSchema.options
      .filter((slot) => container.slots[slot].numSlots > 0)
      .map((slot) => ({
        slot,
        bulkName: getBulkName(getSlotBulk(container, slot)),
        numSlots: container.slots[slot].numSlots,
        used: getUsedSlots(container, slot),
        available: getAvailableSlots(container, slot),
        fits: pending ? canFitItem(container, slot, pending) : null,
        storeCost: c && fromHands && isCharged(c, charged) ? getStoreCost(c, slot, fromHands).AP : null,
        items: container.slots[slot].items.map((item) => ({
          id: item.id,
          name: item.name || item.refId,
          amount: item.amount,
          bulk: item.bulk,
          bulkName: getBulkName(item.bulk),
          slots: getSlotsNeeded(container, slot, item) ?? item.amount,
          ...(c ? getDrawView(c, slot, item, charged) : { drawable: false, drawCost: null }),
          wear: c ? getWearView(c, item, charged) : null,
          putOn: c ? getPutOnView(c, slot, item, charged) : null,
          offerable: isOfferable(item),
        })),
      })),
  }
}

function getContainerMoney(container: Container): string | null {
  const value = getMoneyValue(getContents(container))
  return value > 0 ? formatMoney(value) : null
}

// The whole container panel in one shape: every open container, its slot
// groups and the stacks in each, with nothing left for the UI to count. With
// an item pending placement, each group also says whether it would take it.
export function getContainerPanels(c: Character, charged: boolean, pending?: Item): ContainerPanelView[] {
  return Object.entries(getOpenContainers(c)).map(([key, container]) => getContainerPanel(key, container, charged, pending, c))
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
