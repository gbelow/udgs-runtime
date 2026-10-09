import { describe, it, expect } from 'vitest'
import { trade } from './trade'
import { addItemToContainer, putOnFromCatalog } from '.'
import { getCatalogItem, getItemCatalog } from '../rules/items'
import { getMoneyValue, getPurse, getStackValue } from '../rules/money'
import { findStack, getLineCost, getLineItem, type Trade } from '../rules/trade'
import { getTradeView } from '../projections/trade'
import { makeCharacter } from '../../factories'

const pouch = getCatalogItem('Coin Pouch')!
const gold = getCatalogItem('Gold Coin', 50)!
const dagger = getCatalogItem('Dagger')!
const packed = addItemToContainer('Backpack', 'large', dagger)(
  addItemToContainer('Backpack', 'medium', pouch)(putOnFromCatalog(getCatalogItem('Backpack')!)(makeCharacter(null))),
)
const merchant = addItemToContainer(pouch.id, 'medium', gold)(packed)
const coins = findStack(merchant, gold.id)!.item

// The view says what the trade button would do, and the trade must agree:
// for every entry the catalog sells, paid for from a pouch, an offer the
// view calls able moves exactly the cart's cost out of the purse (and any
// coins bought into it), and one it
// refuses leaves the character as it was.
describe('trade', () => {
  const lines = Object.keys(getItemCatalog()).flatMap((key) => (['medium', 'large'] as const).map((slot) => ({ key, amount: 1, scale: 3, containerKey: 'Backpack', slot })))

  it.each(lines.map((line) => [`${line.key} into ${line.slot}`, line] as const))('agrees with the view buying %s', (_name, line) => {
    const t: Trade = { offered: [coins.id], cart: [line] }
    const after = trade(t)(merchant)
    if (getTradeView(merchant, t).able) {
      expect(getPurse(after)).toBe(getPurse(merchant) - getLineCost(line)! + getMoneyValue([getLineItem(line)!]))
    } else {
      expect(after).toBe(merchant)
    }
  })

  it('pays what goods put down are worth', () => {
    const t: Trade = { offered: [findStack(merchant, dagger.id)!.item.id], cart: [] }
    expect(getTradeView(merchant, t).able).toBe(true)
    expect(getPurse(trade(t)(merchant))).toBe(getPurse(merchant) + getStackValue(dagger))
  })
})
