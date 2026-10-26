import { describe, it, expect } from 'vitest'
import { BoardSchema, SceneStateSchema, type Surface } from '../../types'
import { laySurface } from '../../commands/board'
import { coordKey } from './geometry'
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
        const laid = laySurface(CELL, name, roll)(state)
        const stored = laid.board!.terrain[coordKey(CELL)].art
        expect(stored === null ? listed.length === 0 : listed.includes(stored)).toBe(true)
        expect(getCellArt(laid.board!, coordKey(CELL))?.src ?? null).toBe(stored)
      }
    })
  }

  it('a surface that does not randomize always lays its first', () => {
    for (const name of getSurfaceNames()) {
      const surface: Surface = { ...getSurface(name)!, randomize: false }
      for (const roll of ROLLS) expect(pickArt(surface, roll)).toBe(surface.arts[0] ?? null)
    }
  })
})
