import { Character, CharacterUpdater, Container, Item, SlotKind } from '../../types'
import { getDrawCost } from '../rules/costs'
import { canHoldWith, getHeldItem } from '../rules/hands'
import { WORN_ONE_AT_A_TIME, getContainerItem, getContainerKey, getPutOnView } from '../rules/containers'
import { dropItem, findInContainer, holdItem, pay } from './hands'
import { removeItemFromContainer } from './items'

// gear.tex "Containers": "only one backpack, one bandolier and one belt at a
// time". Equipping one of these replaces whichever other entry is currently
// of that same kind, contents included. Saddles and vehicles aren't limited.
export function equipContainer(key: string, container: Container): CharacterUpdater {
  return (character: Character) => {
    const singleton = WORN_ONE_AT_A_TIME.has(container.kind)
    const remaining = Object.fromEntries(
      Object.entries(character.containers).filter(([otherKey, other]) => {
        if (otherKey === key) return false
        if (singleton && other.kind === container.kind) return false
        return true
      })
    )
    return {
      ...character,
      containers: { ...remaining, [key]: container },
    }
  }
}

// The container a container item puts on, once the view allows it from
// where it is; the view is the one to have refused anything else.
function toPutOn(c: Character, from: SlotKind | 'hand' | null, item: Item): Container {
  const view = getPutOnView(c, from, item)
  if (!view || !item.container) {
    throw new Error(`"${item.name || item.refId}" is not a container to put on`)
  }
  if (!view.able) {
    throw new Error(`"${item.name || item.refId}" cannot be put on: ${view.why}`)
  }
  return item.container
}

// Stamped from the catalog: on the sheet it goes over whatever it displaces,
// which is gone; in play only over nothing, for nothing.
export function putOnFromCatalog(item: Item): CharacterUpdater {
  return (c: Character) => equipContainer(getContainerKey(item), toPutOn(c, null, item))(c)
}

// From the hands, for nothing, with what it carries.
export function putOnFromHands(itemId: string): CharacterUpdater {
  return (c: Character) => {
    const item = getHeldItem(c, itemId)
    if (!item) return c
    const container = toPutOn(c, 'hand', item)
    return equipContainer(getContainerKey(item), container)(dropItem(itemId)(c))
  }
}

// From a slot: drawn at that slot's price and put on.
export function putOnFromContainer(containerKey: string, itemId: string): CharacterUpdater {
  return (c: Character) => {
    const { slot, item } = findInContainer(c, containerKey, itemId)
    const container = toPutOn(c, slot, item)
    const paid = pay(c, getDrawCost(c, slot, item))
    return paid ? equipContainer(getContainerKey(item), container)(removeItemFromContainer(containerKey, itemId, 1)(paid)) : c
  }
}

// Taken off, the container is an item in the hands again with what it
// carries, for nothing; with no hand free to take it, it is dropped, and
// there is no floor yet, so it is gone.
export function takeOffContainer(key: string): CharacterUpdater {
  return (c: Character) => {
    const container = c.containers[key]
    if (!container) return c
    const { [key]: _removed, ...remaining } = c.containers
    const bare = { ...c, containers: remaining }
    const item = getContainerItem(key, container)
    return canHoldWith(bare, item, 1) ? holdItem(item, 1)(bare) : bare
  }
}
