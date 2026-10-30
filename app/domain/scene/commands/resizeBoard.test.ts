import { describe, it, expect } from 'vitest'
import { SceneStateSchema } from '../types'
import { resizeBoard } from './board'

// A shrink once dropped the ground painted beyond the new edge but kept the
// storey cells there.
describe('shrinking the board', () => {
  it('drops what is painted beyond the new edge on every storey, as on the ground', () => {
    const state = SceneStateSchema.parse({
      board: {
        extent: { q: 4, r: 4, s: 4 },
        terrain: { '0,0': { blocking: true }, '3,0': { blocking: true } },
        levels: [{ floor: 3, terrain: { '0,0': { hole: true }, '3,0': {} } }],
      },
    })
    const board = resizeBoard({ q: 1, r: 1, s: 1 })(state).board!
    expect(Object.keys(board.terrain)).toEqual(['0,0'])
    expect(board.levels.map((level) => Object.keys(level.terrain))).toEqual([['0,0']])
  })
})
