import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter, spearman } from '../domain/bot/fixtures'
import { produceEffects } from '../domain/character/rules/production'
import { SPELLS } from '../domain/spells'
import { holdItem } from '../domain/item/commands/hands'
import { ItemSchema } from '../domain/types'
import { dropToFloor } from '../domain/scene/commands/floor'
import { getActionPanel } from '../domain/scene/projections/actionPanel'
import { getOpenAction } from '../domain/scene/rules/log'

// A strike at what lies on the floor, from the click to what stands after.
// Expected values are what was clicked: the item the strike names, and that
// every item the view does not offer is left alone.

const rope = () => ItemSchema.parse({ name: 'Rope', type: 'utility', bulk: 1 })

// Ann, spear in hand, beside Cy's rope and Eve's spear on the floor; Dee's
// spear lies out of her reach.
function scene(): Harness {
  const h = openHarness()
  h.bring(spearman('Ann'), holdItem(rope())(fighter('Cy')), spearman('Eve'), spearman('Dee'))
  h.createBoard(6)
  for (const [name, q, r] of [['Ann', 0, 0], ['Cy', -1, 1], ['Eve', 1, 0], ['Dee', 5, -3]] as const) {
    h.select(name)
    h.cell(q, r)
  }
  for (const name of ['Cy', 'Eve', 'Dee']) for (const item of h.state().characters[h.idOf(name)].held) h.press(dropToFloor(h.idOf(name), item.id))
  h.select('Ann')
  h.startTurn()
  h.declare({ kind: 'strike' })
  const row = getActionPanel(h.state()).attacks[0]
  h.send({ kind: 'amend', args: [{ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] })
  return h
}

const open = (h: Harness) => getOpenAction(h.state())

describe('declaring a strike at the floor', () => {
  it('names every item the view offers and leaves every other alone', () => {
    const count = scene().view().floor.length
    expect(count).toBeGreaterThan(1)
    for (let i = 0; i < count; i++) {
      const h = scene()
      const item = h.view().floor[i]
      h.floor(item.itemId)
      expect(open(h), item.name).toMatchObject(item.targetable ? { targetId: null, object: item.itemId } : { object: '' })
    }
  })

  it('offers something to strike and something not', () => {
    const items = scene().view().floor
    expect(items.some((f) => f.targetable)).toBe(true)
    expect(items.some((f) => !f.targetable)).toBe(true)
  })

  it('leaves nothing waiting once the blow is committed', () => {
    const h = scene()
    h.floor(h.view().floor.find((f) => f.targetable)!.itemId)
    h.commit()
    expect(open(h)).toBeNull()
  })

  it('marks the clicked item as the selected target of the panel', () => {
    const h = scene()
    const first = getActionPanel(h.state()).targets
    expect(first.every((t) => !t.selected)).toBe(true)
    h.floor(h.view().floor.find((f) => f.targetable)!.itemId)
    expect(getActionPanel(h.state()).targets.filter((t) => t.selected)).toHaveLength(1)
  })
})

// spells.tex "Charged": a blow that lands on an object charged to go off on
// impact sets it off where it lies.
describe('a blow on a charge that goes off on impact', () => {
  it('opens its explosion where the object lies', () => {
    const h = openHarness()
    const base = fighter('Gus')
    const grenade = ItemSchema.parse({ name: 'Grenade', type: 'weapon', refId: 'Grenade', bulk: 1 })
    const charged = { ...grenade, charge: { key: 'shock-explosive', effects: produceEffects(base, SPELLS['shock-explosive'].effects) } }
    h.bring(spearman('Ann'), holdItem(charged)(base))
    h.createBoard(6)
    for (const [name, q, r] of [['Ann', 0, 0], ['Gus', 1, 0]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.press(dropToFloor(h.idOf('Gus'), charged.id))
    h.select('Ann')
    h.startTurn()
    h.declare({ kind: 'strike' })
    const row = getActionPanel(h.state()).attacks[0]
    h.send({ kind: 'amend', args: [{ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] })
    h.floor(charged.id)
    h.commit()
    expect(open(h)).toMatchObject({ kind: 'explosion', source: 'thrown', itemId: charged.id, center: { q: 1, r: 0 } })
  })
})
