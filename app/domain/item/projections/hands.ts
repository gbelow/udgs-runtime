import { SPELLS, isSpellKey } from '../../spells'
import type { Character, Item, SlotKind } from '../../types'
import { getWearView, WearView } from '../../character/rules/armor'
import { getBulkName, getItemScale } from '../rules/items'
import { getDrawCost, isCharged } from '../rules/costs'
import { Grip, canHoldWith, getFreeHoldingHands, getGrip, getHeldItem, isLamingHold } from '../rules/hands'

export type HandView = {
  index: number
  name: string
  canHold: boolean
  naturalWeapon: string
  item: { id: string; name: string } | null
}

export type HeldItemView = {
  id: string
  name: string
  amount: number
  bulkName: string
  scale: number
  grip: number
  // gear.tex "Hands": more than one bulk over the holder's size lames them.
  laming: boolean
  // Whether the stack could be regripped to that many hands. Moving between
  // one and two hands costs nothing (gear.tex "Small/One/Two hands").
  canGrip: Record<Grip, boolean>
  // For an armor item, whether it could be put on from here; null otherwise.
  wear: WearView | null
  // spells.tex "Charged": the spell loaded into it, by name; '' for none
  charge: string
}

export type HandsPanelView = {
  hands: HandView[]
  held: HeldItemView[]
  freeHolding: number
  // For the item being placed, whether the hands could take it as is, and
  // whether taking it would lame the holder.
  canHold: Record<Grip, boolean> | null
  lamingHold: boolean
}

export function getHandsPanel(c: Character, pending?: Item): HandsPanelView {
  const freeHolding = getFreeHoldingHands(c).length
  return {
    hands: c.hands.map((hand, index) => {
      const item = hand.itemId ? getHeldItem(c, hand.itemId) : undefined
      return {
        index,
        name: hand.name,
        canHold: hand.canHold,
        naturalWeapon: hand.naturalWeapon,
        item: item ? { id: item.id, name: item.name || item.refId } : null,
      }
    }),
    held: c.held.map((item) => {
      const grip = getGrip(c, item.id)
      return {
        id: item.id,
        name: item.name || item.refId,
        amount: item.amount,
        bulkName: getBulkName(item.bulk),
        scale: getItemScale(item),
        grip,
        laming: isLamingHold(c, item),
        canGrip: { 1: grip !== 1, 2: grip !== 2 && freeHolding >= 1 },
        wear: getWearView(c, null, item),
        charge: item.charge && isSpellKey(item.charge) ? SPELLS[item.charge].name : '',
      }
    }),
    freeHolding,
    canHold: pending ? { 1: canHoldWith(c, pending, 1), 2: canHoldWith(c, pending, 2) } : null,
    lamingHold: pending ? isLamingHold(c, pending) : false,
  }
}

// A container's stack as the hands see it: whether it could be drawn right
// now, and what that would cost a character in play.
export function getDrawView(c: Character, slot: SlotKind, item: Item): { drawable: boolean; drawCost: number | null } {
  return {
    drawable: canHoldWith(c, item, 1),
    drawCost: isCharged(c) ? getDrawCost(c, slot, item).AP : null,
  }
}
