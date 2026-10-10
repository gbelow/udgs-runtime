import { Character, Item } from '../../types'
import { findCoinSeat, getCoins, getPayable, getPurseStacks } from '../rules/money'
import { addItemToContainer, removeItemFromContainer } from './items'

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

// A sum received in coins.
export function receive(coppers: number): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => (coppers <= 0 ? c : getCoins(coppers).reduce<C>(seatCoins, c))
}
