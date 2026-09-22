import { Character, CharacterUpdater, Item, SlotKind } from '../../types'
import { getWearView, getWearCost, getDoffCost, getEquipView, getDonCost } from '../rules/armor'
import { getHeldItem } from '../../item/rules/hands'
import { FREE, isCharged } from '../../item/rules/costs'
import { canFitItem } from '../../item/rules/containers'
import { findInContainer, pay } from '../../item/commands/hands'
import { addItemToContainer, duplicateItem, removeItemFromContainer } from '../../item/commands/items'

// One unit of the stack goes on, at the price of where it came from. The fit
// and the price are the lens's to judge; a character who cannot pay is left
// as they were, the way drawItem leaves them.
function don(c: Character, from: SlotKind | null, item: Item): Character | null {
  const view = getWearView(c, from, item)
  if (!view) {
    throw new Error(`"${item.name || item.refId}" is not armor`)
  }
  if (!view.wearable) {
    throw new Error(`"${item.name || item.refId}" cannot be worn: ${view.why}`)
  }
  const paid = pay(c, getWearCost(c, from, item) ?? FREE)
  return paid && { ...paid, worn: duplicateItem(item, { amount: 1 }) }
}

// gear.tex "Donning and Doffing armor", from a container: drawn from its slot
// and put on.
export function wearFromContainer(containerKey: string, itemId: string): CharacterUpdater {
  return (c: Character) => {
    const { slot, item } = findInContainer(c, containerKey, itemId)
    const worn = don(c, slot, item)
    return worn ? removeItemFromContainer(containerKey, itemId, 1)(worn) : c
  }
}

// From the hands: only put on. The whole stack leaves the hands, since a
// stack of armor in the hands is one suit.
export function wearFromHands(itemId: string): CharacterUpdater {
  return (c: Character) => {
    const item = getHeldItem(c, itemId)
    if (!item) return c
    const worn = don(c, null, item)
    if (!worn) return c
    return {
      ...worn,
      held: worn.held.filter((held) => held.id !== itemId),
      hands: worn.hands.map((hand) => (hand.itemId === itemId ? { ...hand, itemId: '' } : hand)),
    }
  }
}

// An item that is nowhere yet — stamped from the catalog — goes on. On the
// sheet it goes over whatever was worn, which is gone, for nothing: this is
// how a character is dressed. In play it is donned at the don price, and only
// over nothing; the view has already refused anything else.
export function equipArmor(item: Item): CharacterUpdater {
  return (c: Character) => {
    const view = getEquipView(c, item)
    if (!view) {
      throw new Error(`"${item.name || item.refId}" is not armor`)
    }
    if (!view.wearable) {
      throw new Error(`"${item.name || item.refId}" cannot be worn: ${view.why}`)
    }
    const paid = pay(c, getDonCost(c, item) ?? FREE)
    return paid ? { ...paid, worn: duplicateItem(item, { amount: 1 }) } : c
  }
}

// Taken off and put away in one move, at the price of both; or taken off and
// left on the floor, which there is none of yet.
export function doffArmor(into: { containerKey: string; slot: SlotKind } | null): CharacterUpdater {
  return (c: Character) => {
    const worn = c.worn
    if (!worn) return c
    if (into && !canFitItem(c.containers[into.containerKey], into.slot, worn)) {
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

export function putGauntlets(character: Character): Character {
  
  return({
    ...character,
    ['hasGauntlets']: character.hasGauntlets ? 0 : 1
  })
}

export function putHelm(character: Character): Character {
  
  return({
    ...character,
    ['hasHelm']: character.hasHelm ? 0 : 1
  })
}
