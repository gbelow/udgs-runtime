import type { Character } from '../../types'
import { isBaseCharacter } from '../../utils'
import { getCarriedItems } from '../rules/items'
import { getContainerItem } from '../rules/containers'
import { countCoins, getPurse, getStackValue } from '../rules/money'

// A sum of coppers written in coins, largest first: "1 GP 2 SP 5 CP", and
// "0 CP" for nothing.
export function formatMoney(coppers: number): string {
  const parts = countCoins(coppers).map(({ coin, count }) => `${count} ${coin.name}`)
  return parts.length > 0 ? parts.join(' ') : '0 CP'
}

// A price as the catalog shows it; a dash for an item with no price.
export function formatPrice(coppers: number | null): string {
  return coppers === null ? '—' : formatMoney(coppers)
}

// The money the character has on them, written in coins.
export function getPurseLabel(c: Character): string {
  return formatMoney(getPurse(c))
}

// creating.tex "Character Creation", Step 3: "Only 10% of the money can be
// spared, the rest must be spent or lost."
const SPARED_SHARE = 0.1

export type StartingWealthView = { budget: string; left: string; over: boolean; spared: string; overSpared: boolean }

// What is left of the wealth focus's gold once everything the character
// carries is paid for at its price, coins at their face, and whether the
// coins kept are more than may be spared. Null for a character not made by
// the book's steps.
export function getStartingWealthView(c: Character): StartingWealthView | null {
  if (!isBaseCharacter(c) || c.startingWealth === null) return null
  const containers = Object.entries(c.containers).map(([key, container]) => getContainerItem(key, container))
  const spent = [...getCarriedItems(c), ...containers].reduce((total, item) => total + getStackValue(item), 0)
  const spared = Math.floor(c.startingWealth * SPARED_SHARE)
  return {
    budget: formatMoney(c.startingWealth),
    left: formatMoney(Math.abs(c.startingWealth - spent)),
    over: spent > c.startingWealth,
    spared: formatMoney(spared),
    overSpared: getPurse(c) > spared,
  }
}
