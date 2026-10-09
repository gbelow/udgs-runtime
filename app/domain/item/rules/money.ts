import { Character, Item } from '../../types'
import { COINS } from '../../tables'
import { getCarriedItems, getCatalogItem, getItemPrice, isCurrency } from './items'

// What a whole stack is worth at its price, in coppers; nothing for an item
// with no price.
export function getStackValue(item: Item): number {
  return (getItemPrice(item) ?? 0) * item.amount
}

// What the items are worth as money, in coppers: every stack of a currency
// among them at its price, whatever else they are.
export function getMoneyValue(items: Item[]): number {
  return items.reduce((total, item) => total + (isCurrency(item) ? getStackValue(item) : 0), 0)
}

// The money the character has on them, in coppers: the currency in their
// hands and in every container they carry, loose or in a pouch.
export function getPurse(c: Character): number {
  return getMoneyValue(getCarriedItems(c))
}

// A sum of coppers counted out in coins, largest first, as few as can make
// it; a coin none of is needed is left out.
export function countCoins(coppers: number): { coin: (typeof COINS)[number]; count: number }[] {
  let left = coppers
  return COINS.flatMap((coin) => {
    const count = Math.floor(left / coin.value)
    left -= count * coin.value
    return count > 0 ? [{ coin, count }] : []
  })
}

// A sum of coppers paid out in coins, one stack per coin.
export function getCoins(coppers: number): Item[] {
  return countCoins(coppers).flatMap(({ coin, count }) => getCatalogItem(coin.item, count) ?? [])
}
