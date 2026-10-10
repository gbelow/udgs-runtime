import type { Character } from '../../types'
import { canFitItem, getContainer } from '../rules/containers'
import { getCoins, getStackValue } from '../rules/money'
import { Trade, canFitLine, getLineCost, getLineItem, getOfferedStacks, getTradeBalance } from '../rules/trade'
import { formatMoney } from '../rules/money'
import { formatPrice } from './money'

export type TradeView = {
  offered: { id: string; name: string; amount: number; value: string }[]
  cart: { name: string; amount: number; price: string; where: string; fits: boolean }[]
  offeredTotal: string
  cost: string
  change: string
  able: boolean
  why: string
}

// The trade panel in one shape: what is put down and what it is worth, what
// is taken, where it goes and whether it fits, and the change, with nothing
// left for the UI to add up.
export function getTradeView(c: Character, trade: Trade): TradeView {
  const { offered, cost, change, covered } = getTradeBalance(c, trade)
  const cart = trade.cart.map((line) => ({
    name: getLineItem(line)?.name || line.key,
    amount: line.amount,
    price: formatPrice(getLineCost(line)),
    where: `${getContainer(c, line.containerKey)?.name ?? line.containerKey} · ${line.slot}`,
    fits: canFitLine(c, line),
  }))
  const unpriced = trade.cart.some((line) => getLineCost(line) === null)
  const home = getOfferedStacks(c, trade)[0]
  const homeContainer = home && getContainer(c, home.containerKey)
  const changeFits = !homeContainer || getCoins(change).every((coins) => canFitItem(homeContainer, home.slot, coins))
  const why = offered === 0 ? 'put down coins or goods'
    : unpriced ? 'something in the cart has no price'
    : !covered ? `${formatMoney(cost - offered)} short`
    : cart.some((line) => !line.fits) ? 'something in the cart does not fit where it goes'
    : !changeFits ? `the change does not fit where the ${home.item.name || home.item.refId} was`
    : ''
  return {
    offered: getOfferedStacks(c, trade).map(({ item }) => ({ id: item.id, name: item.name || item.refId, amount: item.amount, value: formatMoney(getStackValue(item)) })),
    cart,
    offeredTotal: formatMoney(offered),
    cost: formatMoney(cost),
    change: formatMoney(change),
    able: why === '',
    why,
  }
}
