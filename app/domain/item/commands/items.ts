import { Character, CharacterUpdater, Container, Item, SlotGroup, SlotKind } from '../../types'
import { canFitItem, getContainer, stackInto } from '../rules/containers'

export function duplicateItem(item: Item, overrides: Partial<Pick<Item, 'amount'>> = {}): Item {
  return { ...item, id: crypto.randomUUID(), ...overrides }
}

// The character with the open container `key` changed: one they have on, or
// a quiver slung on one of those.
function withContainer(character: Character, key: string, change: (container: Container) => Container): Character {
  const own = character.containers[key]
  if (own) return { ...character, containers: { ...character.containers, [key]: change(own) } }
  const sling = (container: Container): Container => ({
    ...container,
    slots: {
      ...container.slots,
      quick: {
        ...container.slots.quick,
        items: container.slots.quick.items.map((item) => (item.id === key && item.container ? { ...item, container: change(item.container) } : item)),
      },
    },
  })
  return { ...character, containers: Object.fromEntries(Object.entries(character.containers).map(([k, c]) => [k, sling(c)])) }
}

// gear.tex "Slot size and stacking": an identical stack already in the group
// absorbs the item rather than taking a slot of its own.
export function addItemToContainer(containerKey: string, slot: SlotKind, item: Item): CharacterUpdater {
  return (character: Character) => {
    const container = getContainer(character, containerKey)
    if (!container) {
      throw new Error(`Container "${containerKey}" not found`)
    }
    if (!canFitItem(container, slot, item)) {
      throw new Error(`Item "${item.name || item.refId}" does not fit in the ${slot} slots of container "${containerKey}"`)
    }
    return withContainer(character, containerKey, (open) => {
      const group = open.slots[slot]
      return { ...open, slots: { ...open.slots, [slot]: { ...group, items: stackInto(group.items, item) } } }
    })
  }
}

// An item id is unique across the character, so the slot group it sits in
// need not be named to take it out. With an `amount` only that much of the
// stack leaves; the whole stack goes when it is omitted or not exceeded.
export function removeItemFromContainer(containerKey: string, itemId: string, amount?: number): CharacterUpdater {
  return (character: Character) => {
    if (!getContainer(character, containerKey)) return character

    const without = (group: SlotGroup): SlotGroup => ({
      ...group,
      items: group.items.flatMap((item) => {
        if (item.id !== itemId) return [item]
        if (amount === undefined || amount >= item.amount) return []
        return [{ ...item, amount: item.amount - amount }]
      }),
    })
    return withContainer(character, containerKey, (open) => {
      const { quick, medium, large } = open.slots
      return { ...open, slots: { quick: without(quick), medium: without(medium), large: without(large) } }
    })
  }
}
