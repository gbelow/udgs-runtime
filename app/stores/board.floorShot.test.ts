import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { archer, fighter, warden } from '../domain/bot/fixtures'
import { produceEffects } from '../domain/character/rules/production'
import { SPELLS } from '../domain/spells'
import { holdItem } from '../domain/item/commands/hands'
import { ItemSchema, type CampaignCharacter, type Item } from '../domain/types'
import { HazardLayerSchema, TerrainCellSchema, type Updater } from '../domain/combat/types'
import { coordKey } from '../domain/combat/geometry'
import { dropToFloor } from '../domain/combat/commands/floor'
import { getActionPanel } from '../domain/combat/projections/actionPanel'
import { getOpenAction } from '../domain/combat/rules/log'
import { getAvailableActions } from '../domain/combat/rules/options'
import { declareReaction, rollAction } from '../domain/combat/commands/action'

// A shot at what lies on the floor, from the click to what stands after.
// Expected values are what was clicked and what was laid on the ground: the
// item the shot names, a burning blow lighting the coat of the cell it lands
// on, and nothing offered that the shot would do nothing to.

const rope = () => ItemSchema.parse({ name: 'Rope', type: 'utility', bulk: 1 })
const spear = () => ItemSchema.parse({ name: 'Short Spear', type: 'weapon', refId: 'Short Spear', bulk: 3 })

// A dagger thrown with a charge that adds burning damage on contact.
function burningDagger(base: CampaignCharacter): Item {
  const effects = produceEffects(base, SPELLS['taser'].effects).map((e) =>
    e.type === 'damage' ? { ...e, effect: { ...e.effect, damage: [{ kind: 'burn' as const, value: 10 }] } } : e)
  return ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1, charge: { key: 'taser', effects } })
}

const coat: Updater = (s) => {
  const key = coordKey({ q: 2, r: 0 })
  const was = s.board!.terrain[key] ?? TerrainCellSchema.parse({})
  return { ...s, board: { ...s.board!, terrain: { ...s.board!.terrain, [key]: { ...was, layers: [...was.layers, HazardLayerSchema.parse({ fuel: 'oil' })] } } } }
}

// Ann with `shooter` in hand at the origin, Cy's `lying` on the floor two
// cells away; her turn begun and a shot declared with the first row there is.
function scene(shooter: (name: string) => CampaignCharacter, lying: Item, coated: boolean, guard?: CampaignCharacter): Harness {
  const h = openHarness(() => 10)
  h.bring(shooter('Ann'), holdItem(lying)(fighter('Cy')), ...(guard ? [guard] : []))
  h.createBoard(6)
  for (const [name, q, r] of [['Ann', 0, 0], ['Cy', 2, 0], ...(guard ? [[guard.name, 1, 0] as const] : [])] as const) {
    h.select(name)
    h.cell(q, r)
  }
  h.press(dropToFloor(h.idOf('Cy'), lying.id))
  if (coated) h.press(coat)
  h.select('Ann')
  h.startTurn()
  h.declare({ kind: 'shoot' })
  const row = getActionPanel(h.state()).attacks[0]
  h.amend({ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant })
  return h
}

const dagger = (name: string) => {
  const base = fighter(name)
  return { ...holdItem(burningDagger(base))(base), usedSurge: 'focus' as const }
}
const open = (h: Harness) => getOpenAction(h.state())

describe('declaring a shot at the floor', () => {
  it('names the item the view offers', () => {
    const lying = spear()
    const h = scene(archer, lying, false)
    const item = h.view().floor.find((f) => f.itemId === lying.id)!
    expect(item.targetable).toBe(true)
    h.floor(lying.id)
    expect(open(h)).toMatchObject({ kind: 'shoot', targetId: null, object: lying.id })
  })

  it('offers nothing the shot would do nothing to', () => {
    const lying = rope()
    const h = scene(archer, lying, false)
    expect(h.view().floor.every((f) => !f.targetable)).toBe(true)
    h.floor(lying.id)
    expect(open(h)).toMatchObject({ object: '' })
  })
})

// combat.tex "Fire": a blow that carries burning damage and is aimed at the
// ground lights the fuel there.
describe('a burning shot at a space', () => {
  const coated = [coordKey({ q: 2, r: 0 })]
  const lit = (h: Harness) => h.view().cells.filter((c) => c.fire > 0).map((c) => c.key)

  it('offers the spaces holding unlit fuel, and lights the one clicked', () => {
    const h = scene(dagger, spear(), true)
    expect(h.view().cells.filter((c) => c.center).map((c) => c.key)).toEqual(coated)
    h.cell(2, 0)
    expect(open(h)).toMatchObject({ targetId: null, object: '', cell: { q: 2, r: 0 } })
    h.commit()
    expect(lit(h)).toEqual(coated)
  })

  it('offers nothing on bare ground', () => {
    const h = scene(dagger, spear(), false)
    expect(h.view().cells.some((c) => c.center)).toBe(false)
  })

  it('offers nothing to a shot that is not burning', () => {
    const h = scene(archer, spear(), true)
    expect(h.view().cells.some((c) => c.center)).toBe(false)
  })

  it('lights the space an item aimed at lies in, and no other', () => {
    const lying = spear()
    const h = scene(dagger, lying, true)
    h.floor(lying.id)
    h.commit()
    expect(lit(h)).toEqual(coated)
  })

  it('is stopped by a guard in front of the space', () => {
    const h = scene(dagger, spear(), true, warden('Dee'))
    h.cell(2, 0)
    h.commit()
    expect(open(h)).toMatchObject({ kind: 'shoot', step: 'react' })
    const guard = getAvailableActions(h.state(), h.idOf('Dee')).find((o) => o.draft.kind === 'guard' && o.available)!
    h.press(declareReaction(h.idOf('Dee'), guard.draft, h.newId))
    h.press(rollAction(h.dice, h.newId))
    expect(lit(h)).toEqual([])
  })
})

// combat.tex "Attack against equipment": a shot, like a blow, can be aimed at
// an item the target holds.
describe('a shot at an item held', () => {
  it('offers what the target holds, and aims at the one picked', () => {
    const h = openHarness(() => 10)
    const held = spear()
    h.bring(archer('Ann'), holdItem(held)(fighter('Cy')))
    h.createBoard(6)
    for (const [name, q, r] of [['Ann', 0, 0], ['Cy', 2, 0]] as const) {
      h.select(name)
      h.cell(q, r)
    }
    h.select('Ann')
    h.startTurn()
    h.declare({ kind: 'shoot' })
    const row = getActionPanel(h.state()).attacks[0]
    h.amend({ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant })
    h.token('Cy')
    const offered = getActionPanel(h.state()).items
    expect(offered.map((i) => i.id)).toEqual([held.id])
    h.amend({ object: held.id })
    expect(open(h)).toMatchObject({ targetId: h.idOf('Cy'), object: held.id })
    expect(getActionPanel(h.state()).items.every((i) => i.selected)).toBe(true)
  })
})
