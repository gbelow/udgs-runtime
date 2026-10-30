import { describe, it, expect } from 'vitest'
import { makeBoard } from './factories'
import { BoardSchema } from './types'

// A board is read from storage — a kept map or a saved fight it did not just
// write — so what matters is that reading one is total,
// keeps nothing it cannot vouch for, and survives the trip through JSON.

const HOSTILE: { label: string; raw: unknown }[] = [
  { label: 'null', raw: null },
  { label: 'undefined', raw: undefined },
  { label: 'a number', raw: 42 },
  { label: 'a string', raw: 'not a board' },
  { label: 'an array', raw: [] },
  { label: 'an empty object', raw: {} },
  { label: 'placements that are not a map', raw: { placements: 'here' } },
  { label: 'a null placement', raw: { placements: { ana: null } } },
  { label: 'a placement with a malformed cell', raw: { placements: { ana: { cell: 'north' } } } },
  { label: 'a placement with an orientation off the hex', raw: { placements: { ana: { orientation: 7 } } } },
  { label: 'terrain that is not a map', raw: { terrain: 3 } },
  { label: 'terrain keyed by something that is not a cell', raw: { terrain: { wall: { blocking: true }, '1,x': { blocking: true }, '1,2,3': {} } } },
  { label: 'a cell with an unknown visibility', raw: { terrain: { '0,0': { visibility: 'dim' } } } },
  { label: 'an origin that is not a cell', raw: { origin: 'middle' } },
  { label: 'a radius that is not a whole number', raw: { radius: 2.5 } },
  { label: 'a radius of nothing', raw: { radius: 0 } },
  { label: 'an extent of nothing on one axis', raw: { extent: { q: 3, r: 0, s: 3 } } },
  { label: 'levels that are not a list', raw: { levels: { floor: 3 } } },
  { label: 'a level that is not an object', raw: { levels: [null, 'roof'] } },
  { label: 'a level with a floor that is not a number', raw: { levels: [{ floor: 'up', height: -1 }] } },
  { label: 'a level keyed by something that is not a cell', raw: { levels: [{ terrain: { roof: {}, '0,0': { hole: 'yes' } } }] } },
  { label: 'pieces that are not a map', raw: { pieces: [] } },
  { label: 'a null piece', raw: { pieces: { shed: null } } },
  { label: 'a cell marked with a piece the board does not have', raw: { terrain: { '0,0': { piece: 'shed' } }, levels: [{ piece: 'barn' }] } },
  { label: 'a piece no cell is marked with', raw: { pieces: { shed: { under: { '0,0': { blocking: true } } } } } },
  { label: 'a piece keeping ground under a cell not its own', raw: { terrain: { '0,0': { piece: 'shed' } }, pieces: { shed: { under: { '0,0': { piece: 'barn' }, '1,0': {} } } } } },
]

const populated = () =>
  makeBoard({
    placements: {
      ana: { cell: { q: 2, r: -1 }, orientation: 3, elevation: 1, focus: 'bo' },
      bo: { cell: { q: 3, r: -1 } },
    },
    terrain: {
      '0,0': { blocking: true },
      '1,-1': { difficult: true, elevation: 1 },
      '-1,0': { blocking: true, elevation: 1, piece: 'shed' },
    },
    levels: [{ floor: 3, height: 2, terrain: { '0,0': { blocking: true }, '1,-1': { hole: true } } }, { floor: 4, piece: 'shed', terrain: { '-1,0': {} } }],
    pieces: { shed: { name: 'shed', cell: { q: -1, r: 0 }, rotation: 2, elevation: 1, under: { '-1,0': { difficult: true } } } },
    origin: { q: 4, r: -2 },
    extent: { q: 9, r: 7, s: 5 },
  })

describe('board ingestion is total', () => {
  for (const { label, raw } of HOSTILE) {
    it(`${label} yields a valid board`, () => {
      const board = makeBoard(raw)
      expect(BoardSchema.parse(board)).toEqual(board)
    })
  }

  it('keeps the entries it can read when it drops one it cannot', () => {
    const board = makeBoard({
      placements: { ana: { cell: { q: 1, r: 1 } }, bo: null },
      terrain: { '0,0': { blocking: true }, wall: { blocking: true } },
    })
    expect(Object.keys(board.placements)).toEqual(['ana'])
    expect(Object.keys(board.terrain)).toEqual(['0,0'])
  })

  it('keeps the storeys and storey cells it can read when it drops one it cannot', () => {
    const board = makeBoard({ levels: [null, { floor: 3, terrain: { '0,0': { hole: true }, roof: {} } }] })
    expect(board.levels.map((level) => Object.keys(level.terrain))).toEqual([['0,0']])
  })

  it('keeps nothing it cannot vouch for', () => {
    const board = makeBoard({ placements: { ana: { cell: { q: 0, r: 0 }, token: 'img.png' } }, walls: [] })
    expect((board as Record<string, unknown>).walls).toBeUndefined()
    expect((board.placements.ana as Record<string, unknown>).token).toBeUndefined()
  })
})

describe('board ingestion settles in one pass', () => {
  it.each(HOSTILE.map((c) => [c.label, c.raw] as const))('%s settles in one pass', (_label, raw) => {
    const once = makeBoard(raw)
    expect(makeBoard(once)).toEqual(once)
  })

  it('round-trips a populated board through JSON', () => {
    const board = populated()
    expect(makeBoard(JSON.parse(JSON.stringify(board)))).toEqual(board)
  })
})
