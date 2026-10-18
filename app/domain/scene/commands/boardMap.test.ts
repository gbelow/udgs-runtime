import { describe, it, expect } from 'vitest'
import { loadBoardMap } from './board'
import { getBoardMap } from '../projections/boardMap'
import { BoardMapSchema, BoardSchema, SceneStateSchema } from '../types'
import { makeBoardMap } from '../factories'

// A kept board is stored as JSON (a file, a Redis field) and read back by
// the same best-effort ingestion every board gets.
describe('a kept battle map', () => {
  const painted = SceneStateSchema.parse({
    board: BoardSchema.parse({
      radius: 4,
      light: 'dim',
      placements: { a: { cell: { q: 1, r: 1 } } },
      terrain: { '1,1': { blocking: true, layers: [{ fire: 2 }] }, '0,1': { elevation: 2 } },
    }),
  })

  it('round-trips through JSON onto a fight with nobody standing on it', () => {
    const kept = getBoardMap(painted, 'ford')!
    const stored = JSON.parse(JSON.stringify(kept))
    expect(BoardMapSchema.safeParse(stored).success).toBe(true)
    const loaded = loadBoardMap(stored)(SceneStateSchema.parse({}))
    expect(loaded.board?.placements).toEqual({})
    expect(getBoardMap(loaded, 'ford')).toEqual(kept)
  })

  it('is read whole from whatever comes in', () => {
    for (const raw of [null, 3, 'x', [], {}, { terrain: 4 }, { terrain: { nowhere: {} }, radius: 'wide' }]) {
      expect(BoardMapSchema.safeParse(makeBoardMap(raw)).success).toBe(true)
    }
  })
})
