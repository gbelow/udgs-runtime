import { Character, CharacterUpdater, Item, SlotGroup, SlotKind } from '../../types'
import { canFitItem } from '../lenses/containers'

export function duplicateItem(item: Item, overrides: Partial<Pick<Item, 'amount'>> = {}): Item {
  return { ...item, id: crypto.randomUUID(), ...overrides }
}

export function addItemToContainer(containerKey: string, slot: SlotKind, item: Item): CharacterUpdater {
  return (character: Character) => {
    const container = character.containers[containerKey]
    if (!container) {
      throw new Error(`Container "${containerKey}" not found`)
    }
    if (!canFitItem(container, slot, item)) {
      throw new Error(`Item "${item.name || item.refId}" does not fit in the ${slot} slots of container "${containerKey}"`)
    }
    const group = container.slots[slot]
    return {
      ...character,
      containers: {
        ...character.containers,
        [containerKey]: {
          ...container,
          slots: { ...container.slots, [slot]: { ...group, items: [...group.items, item] } },
        },
      },
    }
  }
}

// An item id is unique across the character, so the slot group it sits in
// need not be named to take it out.
export function removeItemFromContainer(containerKey: string, itemId: string): CharacterUpdater {
  return (character: Character) => {
    const container = character.containers[containerKey]
    if (!container) return character

    const without = <G extends SlotGroup>(group: G): G =>
      ({ ...group, items: group.items.filter(item => item.id !== itemId) })
    const { quick, medium, large } = container.slots
    return {
      ...character,
      containers: {
        ...character.containers,
        [containerKey]: {
          ...container,
          slots: { quick: without(quick), medium: without(medium), large: without(large) },
        },
      },
    }
  }
}
