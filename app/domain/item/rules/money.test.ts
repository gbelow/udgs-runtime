import { describe, it, expect } from 'vitest'
import { getMoneyValue, getPurse } from './money'
import { canFitItem, getOpenContainers } from './containers'
import { getCatalogItem, getItemCatalog, isCurrency } from './items'
import { addItemToContainer, putOnFromCatalog } from '../commands'
import { makeCharacter } from '../../factories'
import { SlotKindSchema } from '../../types'

const currencies = Object.keys(getItemCatalog()).filter((key) => isCurrency(getCatalogItem(key)!))

const pouch = getCatalogItem('Coin Pouch')!
const carrier = addItemToContainer('Backpack', 'medium', pouch)(
  putOnFromCatalog(getCatalogItem('Backpack')!)(putOnFromCatalog(getCatalogItem('Belt')!)(makeCharacter(null))),
)

// Coins are items, so money is counted wherever a stack of it can be put:
// for every slot group of every open container that takes it, the purse
// grows by what the stack alone is worth.
describe('getPurse', () => {
  const places = Object.entries(getOpenContainers(carrier)).flatMap(([key, container]) =>
    SlotKindSchema.options.map((slot) => ({ key, container, slot })))

  it.each(currencies)('counts %s wherever it is placed', (key) => {
    const coins = getCatalogItem(key, 3)!
    const taking = places.filter(({ container, slot }) => canFitItem(container, slot, coins))
    expect(taking.map(({ key }) => key)).toContain(pouch.id)
    for (const { key: at, slot } of taking) {
      expect(getPurse(addItemToContainer(at, slot, coins)(carrier)), `${at} ${slot}`).toBe(getPurse(carrier) + getMoneyValue([coins]))
    }
  })
})
