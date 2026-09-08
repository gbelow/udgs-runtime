import { Character, Container, Item } from '../../types'
import { getSTR } from '../../character/lenses/characteristics'
import { getSize } from '../../character/lenses/misc'

// slots holds 5^(slotBulk - itemBulk): 1 same-bulk item, 5 of the next bulk down, 25 two bulks down
export function getStackCapacity(slotBulk: number, itemBulk: number): number {
  if (itemBulk > slotBulk) return 0
  return 5 ** (slotBulk - itemBulk)
}

export function getUsedSlots(container: Container): number {
  return container.items.reduce((total, item) => {
    if (container.slotBulk >= 3) return total + item.amount // cargo: raw weight/volume units, not the stacking ladder
    const capacity = getStackCapacity(container.slotBulk, item.bulk)
    return total + (capacity > 0 ? Math.ceil(item.amount / capacity) : item.amount)
  }, 0)
}

export function getAvailableSlots(container: Container): number {
  return container.numSlots - getUsedSlots(container)
}

export function canFitItem(container: Container, item: Item): boolean {
  if (container.slotBulk < 3 && item.bulk > container.slotBulk) return false
  const needed = container.slotBulk >= 3
    ? item.amount
    : Math.ceil(item.amount / getStackCapacity(container.slotBulk, item.bulk))
  return needed <= getAvailableSlots(container)
}

export function getContainerPenalty(character: Character, container: Container): number {
  const threshold = container.liftThreshold
  const meetsThreshold = !!threshold && (
    (threshold.STR !== undefined && getSTR(character) >= threshold.STR) ||
    (threshold.size !== undefined && getSize(character) >= threshold.size)
  )
  return meetsThreshold ? Math.max(0, container.penalty - 1) : container.penalty
}

export function getBurdenPenalty(character: Character): number {
  return Object.values(character.containers).reduce(
    (total, container) => total + getContainerPenalty(character, container),
    0
  )
}

// gear.tex "Containers and burden": light has no effect, then -1 / -2 / -3.
// Penalties are stored as positive magnitudes and negated at the point of use.
export function getBurdenLevel(penalty: number): 'light' | 'medium' | 'heavy' | 'over' {
  if (penalty <= 0) return 'light'
  if (penalty === 1) return 'medium'
  if (penalty === 2) return 'heavy'
  return 'over'
}
