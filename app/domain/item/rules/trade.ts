import { Character, Item, SlotKind, SlotKindSchema } from '../../types'
import { canFitItem, getContainer, getOpenContainers } from './containers'
import { getCatalogItem, getItemPrice } from './items'
import { getStackValue, type PlacedStack } from './money'

// One line of what is being bought: a catalog entry, how many, the size it
// is made at, and the slot group it goes into.
export type TradeLine = { key: string; amount: number; scale: number; containerKey: string; slot: SlotKind }

// A trade with a merchant as it is being put together: the stacks the
// character puts down, by id, and what they take. The merchant's side is the
// catalog, with coins enough to pay any change.
export type Trade = { offered: string[]; cart: TradeLine[] }

export type { PlacedStack }

export function findStack(c: Character, itemId: string): PlacedStack | null {
  for (const [containerKey, container] of Object.entries(getOpenContainers(c))) {
    for (const slot of SlotKindSchema.options) {
      const item = container.slots[slot].items.find((i) => i.id === itemId)
      if (item) return { item, containerKey, slot }
    }
  }
  return null
}

// A container is put down with what it carries, which a price does not count,
// so it is never offered; anything else with a price is, coins at their face
// and goods at the catalog's price.
export function isOfferable(item: Item): boolean {
  return !item.container && getItemPrice(item) !== null
}

export function getOfferedStacks(c: Character, trade: Trade): PlacedStack[] {
  return trade.offered.flatMap((id) => {
    const stack = findStack(c, id)
    return stack && isOfferable(stack.item) ? [stack] : []
  })
}

export function getLineItem(line: TradeLine): Item | undefined {
  return getCatalogItem(line.key, line.amount, line.scale)
}

// What a line costs, or null for an entry with no price, which cannot be
// bought.
export function getLineCost(line: TradeLine): number | null {
  const item = getLineItem(line)
  const price = item ? getItemPrice(item) : null
  return price === null ? null : price * line.amount
}

export function canFitLine(c: Character, line: TradeLine): boolean {
  const container = getContainer(c, line.containerKey)
  const item = getLineItem(line)
  return !!container && !!item && canFitItem(container, line.slot, item)
}

// What the stacks put down are worth, what the cart costs, and the change the
// merchant pays back; `covered` once every line has a price and the stacks
// are worth at least the cart.
export function getTradeBalance(c: Character, trade: Trade): { offered: number; cost: number; change: number; covered: boolean } {
  const offered = getOfferedStacks(c, trade).reduce((total, { item }) => total + getStackValue(item), 0)
  const costs = trade.cart.map(getLineCost)
  const cost = costs.reduce<number>((total, line) => total + (line ?? 0), 0)
  const priced = costs.every((line) => line !== null)
  return { offered, cost, change: Math.max(0, offered - cost), covered: priced && offered >= cost && offered > 0 }
}
