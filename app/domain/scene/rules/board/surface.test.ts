import { describe, it, expect } from 'vitest'
import { BoardSchema, SceneStateSchema, type Surface } from '../../types'
import { generateGround, laySurface } from '../../commands/board'
import { coordKey, extentCells } from './geometry'
import { getCellArt, getSurface, getSurfaceNames, pickArt } from './surface'

const ROLLS = [0, 1, 2, 7, 1e12, -3, 2.5, NaN, Infinity]
const CELL = { q: 1, r: 0 }

describe('a laid cell is drawn with a picture its surface lists', () => {
  const state = SceneStateSchema.parse({ board: BoardSchema.parse({}) })

  for (const name of getSurfaceNames()) {
    it(name, () => {
      const surface = getSurface(name)!
      const listed = surface.arts.map((a) => a.src)
      for (const roll of ROLLS) {
        const laid = laySurface(CELL, name, roll, null)(state)
        const stored = laid.board!.terrain[coordKey(CELL)].art
        expect(stored === null ? listed.length === 0 : listed.includes(stored)).toBe(true)
        expect(getCellArt(laid.board!, coordKey(CELL))?.src ?? null).toBe(stored)
      }
    })
  }

  it('lays the frozen picture whatever the roll, and falls back to the roll for one it does not list', () => {
    for (const name of getSurfaceNames()) {
      const surface = getSurface(name)!
      for (const art of surface.arts) {
        for (const roll of ROLLS) {
          const laid = laySurface(CELL, name, roll, art.src)(state)
          expect(laid.board!.terrain[coordKey(CELL)].art).toBe(art.src)
        }
      }
      const listed = surface.arts.map((a) => a.src)
      const stored = laySurface(CELL, name, 0, '/surfaces/not-listed.webp')(state).board!.terrain[coordKey(CELL)].art
      expect(stored === null ? listed.length === 0 : listed.includes(stored)).toBe(true)
    }
  })

  it('a surface that does not randomize always lays its first', () => {
    for (const name of getSurfaceNames()) {
      const surface: Surface = { ...getSurface(name)!, randomize: false }
      for (const roll of ROLLS) expect(pickArt(surface, roll, null)).toBe(surface.arts[0] ?? null)
    }
  })
})

describe('generating the ground of a board', () => {
  const state = SceneStateSchema.parse({ board: BoardSchema.parse({}) })
  const names = getSurfaceNames()
  const recipe = (clump: number) => ({ entries: [{ surface: names[0], weight: 3 }, { surface: names[1], weight: 1 }, { surface: names[2], weight: 0 }], clump })
  const cells = extentCells(state.board!.origin, state.board!.extent)

  for (const clump of [0, 0.5, 1]) {
    it(`covers every cell with a weighted surface and the same seed makes the same ground, at clump ${clump}`, () => {
      const made = generateGround(recipe(clump), 7)(state)
      for (const cell of cells) {
        const laid = made.board!.terrain[coordKey(cell)]
        expect([names[0], names[1]]).toContain(laid.surface)
        expect(getSurface(laid.surface!)!.arts.map((a) => a.src)).toContain(laid.art)
      }
      expect(generateGround(recipe(clump), 7)(state)).toEqual(made)
    })
  }

  it('changes nothing for a recipe that lays no surface of the catalog', () => {
    expect(generateGround({ entries: [{ surface: 'not a surface', weight: 1 }, { surface: names[0], weight: 0 }], clump: 0.5 }, 1)(state)).toBe(state)
    expect(generateGround({ entries: [], clump: 0.5 }, 1)(state)).toBe(state)
  })
})
