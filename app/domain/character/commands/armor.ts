import { Character, CharacterUpdater, Item, SlotKind } from '../../types'
import { getActionCost } from '../rules/actionCosts'
import { getWearView, getDoffCost, getEquipView, getPieceCost } from '../rules/armor'
import { getHeldItem } from '../../item/rules/hands'
import { FREE, isCharged } from '../../item/rules/costs'
import { canFitItem, getContainer } from '../../item/rules/containers'
import { findInContainer, pay } from '../../item/commands/hands'
import { addItemToContainer, duplicateItem, removeItemFromContainer } from '../../item/commands/items'

// One unit of the stack goes on. Whether it can is the view's to judge: it
// fits, nothing is worn, and it is not a fight (gear.tex "Donning and Doffing
// armor": "It is not possible to don armor during combat").
function don(c: Character, item: Item): Character {
  const view = getWearView(c, item)
  if (!view) {
    throw new Error(`"${item.name || item.refId}" is not armor`)
  }
  if (!view.wearable) {
    throw new Error(`"${item.name || item.refId}" cannot be worn: ${view.why}`)
  }
  return { ...c, worn: duplicateItem(item, { amount: 1 }) }
}

// gear.tex "Donning and Doffing armor", from a container: taken from its
// slot and put on.
export function wearFromContainer(containerKey: string, itemId: string): CharacterUpdater {
  return (c: Character) => {
    const { item } = findInContainer(c, containerKey, itemId)
    return removeItemFromContainer(containerKey, itemId, 1)(don(c, item))
  }
}

// From the hands: only put on. The whole stack leaves the hands, since a
// stack of armor in the hands is one suit.
export function wearFromHands(itemId: string): CharacterUpdater {
  return (c: Character) => {
    const item = getHeldItem(c, itemId)
    if (!item) return c
    const worn = don(c, item)
    return {
      ...worn,
      held: worn.held.filter((held) => held.id !== itemId),
      body: worn.body.map((part) => (part.itemId === itemId ? { ...part, itemId: '' } : part)),
    }
  }
}

// An item that is nowhere yet — stamped from the catalog — goes on. On the
// sheet it goes over whatever was worn, which is gone, for nothing: this is
// how a character is dressed. In a fight the view has already refused it.
export function equipArmor(item: Item): CharacterUpdater {
  return (c: Character) => {
    const view = getEquipView(c, item)
    if (!view) {
      throw new Error(`"${item.name || item.refId}" is not armor`)
    }
    if (!view.wearable) {
      throw new Error(`"${item.name || item.refId}" cannot be worn: ${view.why}`)
    }
    return { ...c, worn: duplicateItem(item, { amount: 1 }) }
  }
}

// Taken off and put away in one move, at the price of both; or taken off and
// left on the floor, which there is none of yet.
export function doffArmor(into: { containerKey: string; slot: SlotKind } | null): CharacterUpdater {
  return (c: Character) => {
    const worn = c.worn
    if (!worn) return c
    const container = into ? getContainer(c, into.containerKey) : undefined
    if (into && (!container || !canFitItem(container, into.slot, worn))) {
      throw new Error(`"${worn.name || worn.refId}" does not fit in the ${into.slot} slots of container "${into.containerKey}"`)
    }
    // On the clock, an armor that takes minutes to doff stays on.
    const cost = getDoffCost(c, into?.slot ?? null)
    if (isCharged(c) && !cost) return c
    const paid = pay(c, cost ?? FREE)
    if (!paid) return c
    const bare = { ...paid, worn: null }
    return into ? addItemToContainer(into.containerKey, into.slot, worn)(bare) : bare
  }
}

// gear.tex "Donning and Doffing armor": the pair of gauntlets goes on or
// comes off together, at its price in play; free on the sheet.
export function putGauntlets(c: Character): Character {
  const paid = pay(c, getPieceCost(c, !!c.hasGauntlets))
  return paid ? { ...paid, hasGauntlets: c.hasGauntlets ? 0 : 1 } : c
}

// The closed helmet the same way; it goes on with the visor down.
export function putHelm(c: Character): Character {
  const paid = pay(c, getPieceCost(c, !!c.hasHelm))
  return paid ? { ...paid, hasHelm: c.hasHelm ? 0 : 1, visorOpen: false } : c
}

// gear.tex "Closed helmet": "Opening and closing the visor of a closed helmet
// is a standard action" — paid in play, free on the sheet.
export function toggleVisor(c: Character): Character {
  if (!c.hasHelm) return c
  const paid = pay(c, getActionCost(c, 'standardAction'))
  return paid ? { ...paid, visorOpen: !c.visorOpen } : c
}
