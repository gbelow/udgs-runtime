import { Character, Item } from '../../types'
import { getCarriedItems, getItemPrice, isCurrency } from './items'

// What the items are worth as money, in coppers: every stack of a currency
// among them at its price, whatever else they are.
export function getMoneyValue(items: Item[]): number {
  return items.reduce((total, item) => total + (isCurrency(item) ? (getItemPrice(item) ?? 0) * item.amount : 0), 0)
}

// The money the character has on them, in coppers: the currency in their
// hands and in every container they carry, loose or in a pouch.
export function getPurse(c: Character): number {
  return getMoneyValue(getCarriedItems(c))
}
