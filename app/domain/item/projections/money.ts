import type { Character } from '../../types'
import { isBaseCharacter } from '../../utils'
import { findCoinSeat, formatMoney, getCarriedValue, getCoins, getKeptWealth, getPurse, getSparedWealth } from '../rules/money'

// A price as the catalog shows it; a dash for an item with no price.
export function formatPrice(coppers: number | null): string {
  return coppers === null ? '—' : formatMoney(coppers)
}

// The money the character has on them, written in coins.
export function getPurseLabel(c: Character): string {
  return formatMoney(getPurse(c))
}

export type StartingWealthView = { budget: string; spent: string; kept: string; keptHasNowhere: boolean; left: string; over: boolean; spared: string; overSpared: boolean }

// What is left of the wealth focus's gold once everything the character
// carries is paid for at its price, coins at their face, and whether the
// coins kept are more than may be spared. Null for a character not made by
// the book's steps.
export function getStartingWealthView(c: Character): StartingWealthView | null {
  if (!isBaseCharacter(c) || c.startingWealth === null) return null
  const spent = getCarriedValue(c)
  const spared = getSparedWealth(c.startingWealth)
  const kept = getKeptWealth(c)
  return {
    budget: formatMoney(c.startingWealth),
    spent: formatMoney(spent),
    kept: formatMoney(kept),
    keptHasNowhere: getCoins(kept).some((coins) => !findCoinSeat(c, coins)),
    left: formatMoney(Math.abs(c.startingWealth - spent)),
    over: spent > c.startingWealth,
    spared: formatMoney(spared),
    overSpared: getPurse(c) > spared,
  }
}
