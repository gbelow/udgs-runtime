import { describe, it, expect } from 'vitest'
import { receive } from './money'
import { holdItem, putOnFromCatalog } from '.'
import { getPayable } from '../rules/money'
import { canHoldWith, getFreeHoldingHands } from '../rules/hands'
import { getCatalogItem, getItemCatalog } from '../rules/items'
import { makeCharacter } from '../../factories'
import { Character } from '../../types'

const bare = makeCharacter(null)

const fillHands = (c: Character): Character =>
  Object.keys(getItemCatalog()).reduce((acc, key) => {
    const item = getCatalogItem(key)
    return item && canHoldWith(acc, item, 1) ? holdItem(item, 1)(acc) : acc
  }, c)

const beltedFullHands = fillHands(putOnFromCatalog(getCatalogItem('Belt')!)(bare))

// Downtime paid a job's wage into characters with no regular slot to keep it
// in (one wearing no container; one whose belt has only quick slots and whose
// hands are full), and the coins were silently dropped.
describe('receive', () => {
  it.each([['no container', bare], ['a belt and full hands', beltedFullHands]] as const)('keeps every coin paid to one with %s', (_name, c) => {
    expect(getFreeHoldingHands(beltedFullHands)).toHaveLength(0)
    expect(getPayable(receive(40)(c))).toBe(getPayable(c) + 40)
  })
})
