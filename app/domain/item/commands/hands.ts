import { Character, CharacterUpdater, Item, SlotKind } from '../../types'
import { canBeHeld, getDrawCost, getGrip, getHeldItem, getStoreCost, Grip, isCharged } from '../lenses/hands'
import { canFitItem } from '../lenses/containers'
import { ActionCost } from '../../character/lenses/actionCosts'
import { addItemToContainer, duplicateItem, removeItemFromContainer } from './items'
import { updateSTA } from '../../character/commands/bleed'

// A character in play pays the price or the move does not happen; on the sheet
// nothing is charged. `null` is the refusal, so the caller returns the
// character untouched.
export function pay(c: Character, cost: ActionCost): Character | null {
  if (!isCharged(c)) return c
  if (c.resources.AP < cost.AP || c.resources.STA < cost.STA) return null
  const paid = cost.STA > 0 ? updateSTA(c.resources.STA - cost.STA)(c) : c
  return { ...paid, resources: { ...paid.resources, AP: paid.resources.AP - cost.AP } }
}

// The first free hands that can hold take the stack. Whatever else the move
// costs has been paid by the time this runs.
function grip(c: Character, item: Item, hands: Grip): Character {
  if (!canBeHeld(c, item)) {
    throw new Error(`"${item.name || item.refId}" cannot be held`)
  }
  const free = c.hands.flatMap((hand, index) => (hand.itemId === '' && hand.canHold ? [index] : []))
  if (free.length < hands) {
    throw new Error(`Not enough free hands to hold "${item.name || item.refId}"`)
  }
  const taking = new Set(free.slice(0, hands))
  return {
    ...c,
    held: [...c.held, item],
    hands: c.hands.map((hand, index) => (taking.has(index) ? { ...hand, itemId: item.id } : hand)),
  }
}

function release(c: Character, itemId: string): Character {
  return {
    ...c,
    held: c.held.filter((item) => item.id !== itemId),
    hands: c.hands.map((hand) => (hand.itemId === itemId ? { ...hand, itemId: '' } : hand)),
  }
}

// Takes a stack that is nowhere yet — stamped from the catalog — into the
// hands. Nothing is charged: it did not come out of a slot.
export function holdItem(item: Item, hands: Grip = 1): CharacterUpdater {
  return (c: Character) => grip(c, item, hands)
}

// gear.tex "Small/One/Two hands": a held stack moves between one hand and two
// at no cost. The hand already on it stays; a second free hand joins or lets go.
export function regripItem(itemId: string, hands: Grip): CharacterUpdater {
  return (c: Character) => {
    const current = getGrip(c, itemId)
    if (current === 0 || current === hands) return c
    if (hands === 1) {
      let kept = false
      return {
        ...c,
        hands: c.hands.map((hand) => {
          if (hand.itemId !== itemId) return hand
          if (kept) return { ...hand, itemId: '' }
          kept = true
          return hand
        }),
      }
    }
    const joining = c.hands.findIndex((hand) => hand.itemId === '' && hand.canHold)
    if (joining < 0) {
      throw new Error('No free hand to grip with')
    }
    return { ...c, hands: c.hands.map((hand, index) => (index === joining ? { ...hand, itemId } : hand)) }
  }
}

// The stack an id names in a container, and the slot group it sits in.
export function findInContainer(c: Character, containerKey: string, itemId: string): { slot: SlotKind; item: Item } {
  const container = c.containers[containerKey]
  if (!container) {
    throw new Error(`Container "${containerKey}" not found`)
  }
  const found = (Object.keys(container.slots) as SlotKind[]).flatMap((slot) =>
    container.slots[slot].items.flatMap((item) => (item.id === itemId ? [{ slot, item }] : [])),
  )[0]
  if (!found) {
    throw new Error(`Item "${itemId}" not in container "${containerKey}"`)
  }
  return found
}

// combat.tex "Drawing items in combat": one unit leaves the container's stack
// for the hands, at the price of where it sat.
export function drawItem(containerKey: string, itemId: string, hands: Grip = 1): CharacterUpdater {
  return (c: Character) => {
    const found = findInContainer(c, containerKey, itemId)
    const paid = pay(c, getDrawCost(c, found.slot, found.item))
    if (!paid) return c
    const unit = duplicateItem(found.item, { amount: 1 })
    return grip(removeItemFromContainer(containerKey, itemId, 1)(paid), unit, hands)
  }
}

// combat.tex "Putting items away": the held stack goes into a slot group, at
// the price of the group it goes into.
export function storeItem(itemId: string, containerKey: string, slot: SlotKind): CharacterUpdater {
  return (c: Character) => {
    const item = getHeldItem(c, itemId)
    if (!item) return c
    const container = c.containers[containerKey]
    if (!container) {
      throw new Error(`Container "${containerKey}" not found`)
    }
    if (!canFitItem(container, slot, item)) {
      throw new Error(`Item "${item.name || item.refId}" does not fit in the ${slot} slots of container "${containerKey}"`)
    }
    const paid = pay(c, getStoreCost(c, slot, item))
    if (!paid) return c
    return addItemToContainer(containerKey, slot, item)(release(paid, itemId))
  }
}

// combat.tex "Putting items away": "Dropping items on the floor costs 0 AP".
// There is no floor yet, so the stack is gone.
export function dropItem(itemId: string): CharacterUpdater {
  return (c: Character) => (getHeldItem(c, itemId) ? release(c, itemId) : c)
}
