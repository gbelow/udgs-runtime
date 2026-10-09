import { Character, Item, SlotKind } from '../../types'
import { canFitItem, getContainer } from '../rules/containers'
import { getCoins } from '../rules/money'
import { Trade, getLineItem, getOfferedStacks, getTradeBalance } from '../rules/trade'
import { addItemToContainer, removeItemFromContainer } from './items'

// The item added to the slot group, or null when it does not fit there.
function placed<C extends Character>(c: C | null, containerKey: string, slot: SlotKind, item: Item | undefined): C | null {
  if (!c || !item) return null
  const container = getContainer(c, containerKey)
  return container && canFitItem(container, slot, item) ? addItemToContainer(containerKey, slot, item)(c) : null
}

// The stacks put down leave, what was bought goes where each line says, and
// the change lands where the first stack lay. Nothing happens unless the
// stacks cover the cart and everything fits.
export function trade(t: Trade): <C extends Character>(c: C) => C {
  return <C extends Character>(c: C): C => {
    const { change, covered } = getTradeBalance(c, t)
    const stacks = getOfferedStacks(c, t)
    if (!covered || stacks.length === 0) return c
    const paid = stacks.reduce<C>((acc, { item, containerKey }) => removeItemFromContainer(containerKey, item.id)(acc), c)
    const bought = t.cart.reduce<C | null>((acc, line) => placed(acc, line.containerKey, line.slot, getLineItem(line)), paid)
    const home = stacks[0]
    return getCoins(change).reduce<C | null>((acc, coins) => placed(acc, home.containerKey, home.slot, coins), bought) ?? c
  }
}
