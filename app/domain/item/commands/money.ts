import { Character, Item } from '../../types'
import { findCoinSeat, getCoins, getPayable, getPouchOf, getPurseStacks } from '../rules/money'
import { canHoldWith } from '../rules/hands'
import { getContainerKey } from '../rules/containers'
import { addItemToContainer, removeItemFromContainer } from './items'
import { holdItem } from './hands'

// A stack of coins put where it fits (quick slots are for combat); a stack
// with nowhere to go is not taken.
export function seatCoins<C extends Character>(c: C, coins: Item): C {
  const at = findCoinSeat(c, coins)
  return at ? addItemToContainer(at.containerKey, at.slot, coins)(c) : c
}

// A sum paid out of the purse: every coin is put down and the change comes
// back where the first stack lay. Nothing happens unless the purse covers it.
export function pay(coppers: number): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => {
    const stacks = getPurseStacks(c)
    const change = getPayable(c) - coppers
    if (coppers <= 0 || change < 0 || stacks.length === 0) return c
    const emptied = stacks.reduce<C>((acc, { item, containerKey }) => removeItemFromContainer(containerKey, item.id)(acc), c)
    const home = stacks[0]
    return getCoins(change).reduce<C>((acc, coins) => addItemToContainer(home.containerKey, home.slot, coins)(acc), emptied)
  }
}

// A stack of coins put where it fits, or, with nowhere to go, into a new coin
// pouch of its own, kept where the pouch is open to pay from — a regular slot,
// or on its own when none is already — and failing both, in a free hand.
function keepCoins<C extends Character>(c: C, coins: Item): C {
  if (findCoinSeat(c, coins)) return seatCoins(c, coins)
  const pouch = getPouchOf(coins)
  if (!pouch?.container) return c
  const at = findCoinSeat(c, pouch)
  if (at) return addItemToContainer(at.containerKey, at.slot, pouch)(c)
  const key = getContainerKey(pouch)
  if (!(key in c.containers)) return { ...c, containers: { ...c.containers, [key]: pouch.container } }
  return canHoldWith(c, pouch, 1) ? holdItem(pouch, 1)(c) : c
}

// A sum received in coins.
export function receive(coppers: number): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => (coppers <= 0 ? c : getCoins(coppers).reduce<C>(keepCoins, c))
}
