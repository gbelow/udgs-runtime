import { Character, CharacterUpdater, Item, SlotGroup, SlotKind } from '../../types'
import { canFitItem, stackInto } from '../rules/containers'

export function duplicateItem(item: Item, overrides: Partial<Pick<Item, 'amount'>> = {}): Item {
  return { ...item, id: crypto.randomUUID(), ...overrides }
}

// gear.tex "Slot size and stacking": an identical stack already in the group
// absorbs the item rather than taking a slot of its own.
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
          slots: { ...container.slots, [slot]: { ...group, items: stackInto(group.items, item) } },
        },
      },
    }
  }
}

// An item id is unique across the character, so the slot group it sits in
// need not be named to take it out. With an `amount` only that much of the
// stack leaves; the whole stack goes when it is omitted or not exceeded.
export function removeItemFromContainer(containerKey: string, itemId: string, amount?: number): CharacterUpdater {
  return (character: Character) => {
    const container = character.containers[containerKey]
    if (!container) return character

    const without = <G extends SlotGroup>(group: G): G => ({
      ...group,
      items: group.items.flatMap((item) => {
        if (item.id !== itemId) return [item]
        if (amount === undefined || amount >= item.amount) return []
        return [{ ...item, amount: item.amount - amount }]
      }),
    })
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
