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
