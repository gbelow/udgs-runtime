import { Character, Container, Item, SlotKind, SlotKindSchema } from '../../types'
import { isBaseCharacter } from '../../utils'
import { COINS } from '../../tables'
import { canFitItem, getContainerItem, getOpenContainers, stackInto } from './containers'
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

// A sum of coppers written in coins, largest first: "1 GP 2 SP 5 CP", and
// "0 CP" for nothing.
export function formatMoney(coppers: number): string {
  const parts = countCoins(coppers).map(({ coin, count }) => `${count} ${coin.name}`)
  return parts.length > 0 ? parts.join(' ') : '0 CP'
}

// What everything the character carries is worth at its price, in coppers:
// coins at their face, the containers as the items they are, nothing for what
// has no price.
export function getCarriedValue(c: Character): number {
  const containers = Object.entries(c.containers).map(([key, container]) => getContainerItem(key, container))
  return [...getCarriedItems(c), ...containers].reduce((total, item) => total + getStackValue(item), 0)
}

// creating.tex "Character Creation", Step 3: "Only 10% of the money can be
// spared, the rest must be spent or lost."
const SPARED_SHARE = 0.1
export function getSparedWealth(startingWealth: number): number {
  return Math.floor(startingWealth * SPARED_SHARE)
}

// creating.tex "Character Creation", Step 3: what the character keeps of the
// gold they did not spend — the tenth that may be spared, less the coins they
// already carry.
export function getKeptWealth(c: Character): number {
  if (!isBaseCharacter(c) || c.startingWealth === null) return 0
  return Math.max(0, Math.min(c.startingWealth - getCarriedValue(c), getSparedWealth(c.startingWealth) - getPurse(c)))
}

// The catalog row a pouch for loose coins is stamped from.
const COIN_POUCH = 'Coin Pouch'

// The first regular slot group of the container that takes the item (quick
// slots are for combat), or none.
function findRegularSlot(container: Container, item: Item): SlotKind | undefined {
  return SlotKindSchema.options.find((kind) => kind !== 'quick' && canFitItem(container, kind, item))
}

// Where a stack of coins, or a pouch of them, is carried: the first regular
// slot group of an open container that takes it, or null.
export function findCoinSeat(c: Character, coins: Item): { containerKey: string; slot: SlotKind } | null {
  for (const [containerKey, container] of Object.entries(getOpenContainers(c))) {
    const slot = findRegularSlot(container, coins)
    if (slot) return { containerKey, slot }
  }
  return null
}

// gear.tex "Coin Pouch": a new pouch holding the stack, or none if it does not
// fit in one.
export function getPouchOf(coins: Item): Item | undefined {
  const pouch = getCatalogItem(COIN_POUCH)
  if (!pouch?.container) return undefined
  const slot = findRegularSlot(pouch.container, coins)
  if (!slot) return undefined
  const group = pouch.container.slots[slot]
  return { ...pouch, container: { ...pouch.container, slots: { ...pouch.container.slots, [slot]: { ...group, items: stackInto(group.items, coins) } } } }
}

// A sum of coppers paid out in coins, one stack per coin.
export function getCoins(coppers: number): Item[] {
  return countCoins(coppers).flatMap(({ coin, count }) => getCatalogItem(coin.item, count) ?? [])
}

// A stack the character carries in an open container, and where it lies.
export type PlacedStack = { item: Item; containerKey: string; slot: SlotKind }

// The coins the character can pay with: every stack of a currency in an open
// container, and where it lies.
export function getPurseStacks(c: Character): PlacedStack[] {
  return Object.entries(getOpenContainers(c)).flatMap(([containerKey, container]) =>
    SlotKindSchema.options.flatMap((slot) => container.slots[slot].items.filter(isCurrency).map((item) => ({ item, containerKey, slot }))))
}

// What the character can pay out of their containers, in coppers.
export function getPayable(c: Character): number {
  return getMoneyValue(getPurseStacks(c).map(({ item }) => item))
}
