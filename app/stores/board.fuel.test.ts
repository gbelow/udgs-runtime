import { describe, expect, it } from 'vitest'
import { openHarness, type Harness } from './boardHarness'
import { fighter } from '../domain/bot/fixtures'
import { holdItem } from '../domain/item/commands/hands'
import { ItemSchema } from '../domain/types'
import { HazardLayerSchema, TerrainCellSchema, type Updater } from '../domain/scene/types'
import { coordKey } from '../domain/scene/geometry'

// A flask thrown at the board and a fire put out, from the click to what
// stands after. Expected values are where the click landed; the game numbers
// are the book's.

const flask = () => ItemSchema.parse({ name: 'Oil Flask', type: 'flammable', bulk: 1, fuel: 'oil' })

function scene(): Harness {
  const h = openHarness()
  h.bring(holdItem(flask())(fighter('Ann')))
  h.createBoard(6)
  h.select('Ann')
  h.cell(0, 0)
  h.startTurn()
  return h
}

const burn = (q: number, r: number, fire: number): Updater => (s) => {
  const key = coordKey({ q, r })
  const was = s.board!.terrain[key] ?? TerrainCellSchema.parse({})
  return { ...s, board: { ...s.board!, terrain: { ...s.board!.terrain, [key]: { ...was, layers: [...was.layers, HazardLayerSchema.parse({ fire })] } } } }
}

function throwFlask(h: Harness, q: number, r: number) {
  h.declare({ kind: 'throw' })
  h.amend({ itemId: h.state().characters[h.idOf('Ann')].held[0].id })
  h.cell(q, r)
  h.commit()
}

const cellAt = (h: Harness, q: number, r: number) => h.view().cells.find((c) => c.key === coordKey({ q, r }))!

describe('throwing a flask of fuel', () => {
  it('coats the cell it was aimed at, and no other, burning nowhere', () => {
    const aimed = (() => {
      const h = scene()
      h.declare({ kind: 'throw' })
      h.amend({ itemId: h.state().characters[h.idOf('Ann')].held[0].id })
      return h.view().cells.filter((c) => c.center).map((c) => c.cell)
    })()
    expect(aimed.length).toBeGreaterThan(1)
    for (const { q, r } of aimed) {
      const h = scene()
      throwFlask(h, q, r)
      const coated = h.view().cells.filter((c) => c.fuels.length > 0).map((c) => c.key)
      expect(coated, `${q},${r}`).toEqual([coordKey({ q, r })])
      expect(h.view().cells.every((c) => c.fire === 0)).toBe(true)
      expect(h.state().floor).toHaveLength(0)
    }
  })

  it('burns at once on a burning cell, as hot as the hottest fire there', () => {
    // combat.tex "Fire": Burning Oil/Alcohol deals 8 per round
    const hotter = scene()
    hotter.press(burn(2, 0, 12))
    throwFlask(hotter, 2, 0)
    expect(cellAt(hotter, 2, 0).fire).toBe(12)
    const cooler = scene()
    cooler.press(burn(2, 0, 3))
    throwFlask(cooler, 2, 0)
    expect(cellAt(cooler, 2, 0).fire).toBe(8)
  })
})

describe('putting a fire out', () => {
  it('is offered only for a burning cell in reach, and clears just that one', () => {
    const none = scene()
    none.declare({ kind: 'extinguish' })
    expect(none.state().actions.some((a) => a.kind === 'extinguish')).toBe(false)

    const h = scene()
    h.press(burn(1, 0, 8))
    h.press(burn(0, 0, 8))
    h.press(burn(4, 0, 8))
    h.declare({ kind: 'extinguish' })
    expect(h.view().cells.filter((c) => c.center).map((c) => c.key).sort()).toEqual([coordKey({ q: 0, r: 0 }), coordKey({ q: 1, r: 0 })].sort())
    h.cell(1, 0)
    h.commit()
    expect(cellAt(h, 1, 0).fire).toBe(0)
    expect(cellAt(h, 0, 0).fire).toBe(8)
    expect(cellAt(h, 4, 0).fire).toBe(8)
  })

  it('puts out the burning of a coated cell, coat and all', () => {
    const h = scene()
    h.press(burn(1, 0, 8))
    throwFlask(h, 1, 0)
    expect(cellAt(h, 1, 0).fuels).toEqual(['oil'])
    h.declare({ kind: 'extinguish' })
    h.cell(1, 0)
    h.commit()
    expect(cellAt(h, 1, 0).fire).toBe(0)
    expect(cellAt(h, 1, 0).fuels).toEqual([])
  })
})
