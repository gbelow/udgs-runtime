import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { getCarriedItems, getCatalogItem } from '../../item/rules/items'
import { getConsume } from '../../item/rules/consumables'
import { holdItem, spendDoses } from '../../item/commands/hands'
import { addItemToContainer } from '../../item/commands/items'
import { putOnFromCatalog } from '../../item/commands/containers'
import { takeDose } from './consume'
import type { Character } from '../../types'
import itemsCatalog from '../../../assets/items.json'

const entries = Object.keys(itemsCatalog as Record<string, unknown>).filter((key) => getConsume(getCatalogItem(key)!) !== null)

// gear.tex "Potions and Medicine": "10 charges", "5 charges" — a stack gives
// out exactly the charges its units are printed with, one at a time, and
// nothing once they are gone.
describe('a stack of something taken', () => {
  it.each(entries)('%s gives out its printed charges per unit', (key) => {
    const units = 3
    const item = getCatalogItem(key, units)!
    const printed = getConsume(item)!.doses
    const carried = (c: Character) => getCarriedItems(c).some((i) => i.id === item.id)
    let c: Character = addItemToContainer('Backpack', 'medium', item)(putOnFromCatalog(getCatalogItem('Backpack')!)(makeCampaignCharacter({ name: 'm' })))
    for (let taken = 0; taken < units * printed; taken++) {
      expect(carried(c), `${key} after ${taken}`).toBe(true)
      c = spendDoses(item.id, 1)(c)
    }
    expect(carried(c)).toBe(false)
  })
})

// gear.tex "Potions and Medicine": "Taking multiple potions does not amplify
// the effect" — the bank holds the best one taken, whatever the order (the
// table's ruling: the highest of what is held and what comes in).
describe('healing potions taken one after another', () => {
  const healing = entries.filter((key) => getConsume(getCatalogItem(key)!)!.effects.some((e) => e.type === 'heal' && e.effect.of === 'potion'))
  const amount = (key: string) => Math.max(...getConsume(getCatalogItem(key)!)!.effects.map((e) => (e.type === 'heal' ? e.effect.amount : 0)))
  const pairs = healing.flatMap((a) => healing.map((b) => [a, b] as const))

  it.each(pairs)('%s then %s banks the larger', (a, b) => {
    const first = getCatalogItem(a)!
    const second = getCatalogItem(b)!
    const c = holdItem(second)(holdItem(first)({ ...makeCampaignCharacter({ name: 'd' }), id: 'd' }))
    const drunk = takeDose(second.id)(takeDose(first.id)(c))
    expect(drunk.injuries.potion).toBe(Math.max(amount(a), amount(b)))
  })
})
