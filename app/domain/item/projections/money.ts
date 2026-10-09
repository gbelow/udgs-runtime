import type { Character } from '../../types'
import { COINS } from '../../tables'
import { getPurse } from '../rules/money'

// A sum of coppers written in coins, largest first: "1 GP 2 SP 5 CP", and
// "0 CP" for nothing.
export function formatMoney(coppers: number): string {
  const parts: string[] = []
  let left = coppers
  for (const coin of COINS) {
    const count = Math.floor(left / coin.value)
    left -= count * coin.value
    if (count > 0) parts.push(`${count} ${coin.name}`)
  }
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
