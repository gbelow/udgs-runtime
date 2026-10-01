import { SPELLS, isSpellKey } from '../../spells'
import type { Character, Item, SlotKind } from '../../types'
import { getWearView, WearView } from '../../character/rules/armor'
import { getBulkName, getItemScale } from '../rules/items'
import { MoveView, getDrawCost, isCharged } from '../rules/costs'
import { getPutOnView } from '../rules/containers'
import { Grip, canHoldWith, getBackMoveCost, getFreeHoldingHands, getGrip, getHeldItem, getNaturalWeapon, getSlingView, getUnslingView, isLamingHold } from '../rules/hands'

// A part that holds or fights: a hand, a paw, a jaw.
export type HandView = {
  id: string
  name: string
  grip: boolean
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
  // for a container, whether it could be put on from the hands
  putOn: MoveView | null
  // for a shield, whether it could be slid to the back
  sling: MoveView | null
  // spells.tex "Charged": the spell loaded into it, by name; '' for none
  charge: string
}

// gear.tex "Shields": the shield slid to the back, and what bringing it to
// the front or throwing it off would take.
export type BackView = {
  name: string
  unsling: MoveView
  throwOffCost: number | null
}

export type HandsPanelView = {
  hands: HandView[]
  held: HeldItemView[]
  back: BackView | null
  freeHolding: number
  // For the item being placed, whether the hands could take it as is, and
  // whether taking it would lame the holder.
  canHold: Record<Grip, boolean> | null
  lamingHold: boolean
}

export function getHandsPanel(c: Character, pending?: Item): HandsPanelView {
  const freeHolding = getFreeHoldingHands(c).length
  return {
    hands: c.body.filter((part) => !part.lost && (part.grip || part.naturalWeapon)).map((part) => {
      const item = part.itemId ? getHeldItem(c, part.itemId) : undefined
      return {
        id: part.id,
        name: part.name,
        grip: part.grip,
        naturalWeapon: getNaturalWeapon(c, part),
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
        wear: getWearView(c, item),
        putOn: getPutOnView(c, 'hand', item),
        sling: getSlingView(c, item),
        charge: item.charge && isSpellKey(item.charge.key) ? SPELLS[item.charge.key].name : '',
      }
    }),
    back: getBackView(c),
    freeHolding,
    canHold: pending ? { 1: canHoldWith(c, pending, 1), 2: canHoldWith(c, pending, 2) } : null,
    lamingHold: pending ? isLamingHold(c, pending) : false,
  }
}

function getBackView(c: Character): BackView | null {
  const item = c.onBack
  if (!item) return null
  return { name: item.name || item.refId, unsling: getUnslingView(c, item), throwOffCost: getBackMoveCost(c) }
}

// A container's stack as the hands see it: whether it could be drawn right
// now, and what that would cost a character in play.
export function getDrawView(c: Character, slot: SlotKind, item: Item): { drawable: boolean; drawCost: number | null } {
  return {
    drawable: canHoldWith(c, item, 1),
    drawCost: isCharged(c) ? getDrawCost(c, slot, item).AP : null,
  }
}
