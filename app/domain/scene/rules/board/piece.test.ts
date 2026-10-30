import { describe, it, expect } from 'vitest'
import { BoardSchema, StructureSchema, type Board } from '../../types'
import { coordKey } from './geometry'
import { getTerrainAt } from './board'
import { getPieceCells, getPieceStructure, layPiece, liftPiece } from './piece'

// A house: walls on two cells, a floor over three, one of them a stairwell.
const house = StructureSchema.parse({
  name: 'house',
  terrain: { '0,0': { elevation: 0 }, '1,0': { blocking: true, RES: 10 }, '0,1': { blocking: true, transparent: true } },
  levels: [{ floor: 3, height: 3, terrain: { '0,0': {}, '1,0': {}, '0,1': { hole: true } } }],
})

const ground = (): Board => BoardSchema.parse({
  extent: { q: 6, r: 6, s: 6 },
  terrain: { '2,-1': { elevation: 2, surface: 'grass' }, '3,-1': { difficult: true }, '5,0': { blocking: true } },
})

const anchor = { q: 2, r: -1 }
const ROTATIONS = [0, 1, 2, 3, 4, 5]

// The table's ruling: a structure is laid on the map as one piece, moved,
// turned and lifted whole, and lifting it gives the map's own ground back.
describe('a piece laid on the board', () => {
  for (const rotation of ROTATIONS) {
    it(`lifts back to the board as it was, turned ${rotation} times`, () => {
      const laid = layPiece(ground(), 'h', house, anchor, rotation)!
      expect(liftPiece(laid, 'h')).toEqual(ground())
    })

    it(`reads back as the structure it was laid from, turned ${rotation} times`, () => {
      const laid = layPiece(ground(), 'h', house, anchor, rotation)!
      expect(getPieceStructure(laid, 'h')).toEqual(house)
    })
  }

  it('covers every cell of the structure and no other', () => {
    const laid = layPiece(ground(), 'h', house, anchor, 0)!
    expect(getPieceCells(laid, 'h').sort()).toEqual(['2,-1', '3,-1', '2,0'].sort())
  })

  // The table's ruling: a structure's heights are measured from the ground
  // under its anchor.
  it('stands its storeys on the ground under its anchor', () => {
    const laid = layPiece(ground(), 'h', house, anchor, 0)!
    const raised = ground().terrain[coordKey(anchor)].elevation
    expect(getTerrainAt(laid, { q: 3, r: -1 }, raised + house.levels[0].floor).floor).toBe(raised + house.levels[0].floor)
  })

  it('is refused where a cell of it would fall on another piece', () => {
    const laid = layPiece(ground(), 'h', house, anchor, 0)!
    expect(layPiece(laid, 'g', house, { q: 3, r: -1 }, 0)).toBeNull()
  })

  // The table's ruling: two canopies grow together where both are lattice,
  // and storeys a cliff apart pass over each other; two solid floors at one
  // height never share a cell.
  it('shares a storey cell with another piece where both are lattice, or a cliff apart, and nowhere else', () => {
    const tree = (lattice: boolean, floor: number) => StructureSchema.parse({ name: 'tree', terrain: { '0,0': { blocking: true } }, levels: [{ floor, terrain: { '0,0': { lattice }, '1,0': { lattice } } }] })
    const first = layPiece(ground(), 'a', tree(true, 4), { q: 3, r: 0 }, 0)!
    expect(layPiece(first, 'b', tree(true, 4), { q: 4, r: 0 }, 0)).not.toBeNull()
    expect(layPiece(first, 'b', tree(false, 4), { q: 4, r: 0 }, 0)).toBeNull()
    expect(layPiece(first, 'b', tree(false, 6), { q: 4, r: 0 }, 0)).not.toBeNull()
  })

  it('is refused where a cell of it would fall beyond the edge', () => {
    expect(layPiece(ground(), 'h', house, { q: 6, r: 0 }, 0)).toBeNull()
  })
})
