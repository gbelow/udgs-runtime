import { describe, it, expect } from 'vitest'
import { addCharacterToCombat, makeBoard } from './factories'
import { makeCampaignCharacter } from '../factories'
import { BoardSchema } from './types'

// A board is the domain's door to a VTT — a snapshot it did not write, keyed
// and shaped by someone else — so what matters is that reading one is total,
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
    },
    origin: { q: 4, r: -2 },
    radius: 9,
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

// Adding the same character sheet to a fight twice replaced the first copy:
// makeCampaignCharacter carries the incoming id through, and the combat store
// keys its characters by that id, so the second add overwrote the first.
describe('addCharacterToCombat', () => {
  it('issues a duplicate copy an id the fight is not already using', () => {
    const sheet = makeCampaignCharacter({ name: 'Bob' })

    const first = addCharacterToCombat(sheet, {}, () => 'issued-1')
    const second = addCharacterToCombat(sheet, { [first.id]: first }, () => 'issued-2')

    expect(first.id).toBe(sheet.id)
    expect(second.id).toBe('issued-2')
  })
})
