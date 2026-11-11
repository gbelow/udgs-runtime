import { describe, it, expect } from 'vitest'
import { BoardSchema, TerrainCellSchema } from '../../types'
import { getBalanceDLAt } from './board'
import { extentCells } from './geometry'

// A difficult cell's DL strays from its ground's by at most the spread, the
// same each time it is read, and not at all where the spread is none.
describe('the DL of a difficult cell', () => {
  const SPREAD = 3
  const ground = TerrainCellSchema.parse({ difficult: true, DL: 2, DLSpread: SPREAD })
  const flat = TerrainCellSchema.parse({ difficult: true, DL: 2 })

  it('stays within the spread of the ground and reads the same twice, on any board', () => {
    for (const seed of [0, 1, 7, 123456789, 0x7fffffff]) {
      const board = BoardSchema.parse({ seed })
      for (const cell of extentCells(board.origin, board.extent)) {
        const DL = getBalanceDLAt(board, cell, ground)
        expect(Math.abs(DL - ground.DL)).toBeLessThanOrEqual(SPREAD)
        expect(getBalanceDLAt(board, cell, ground)).toBe(DL)
        expect(getBalanceDLAt(board, cell, flat)).toBe(flat.DL)
      }
    }
  })
})
