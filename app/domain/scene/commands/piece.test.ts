import { describe, it, expect } from 'vitest'
import { BoardSchema, SceneStateSchema, StructureSchema, type SceneState } from '../types'
import { STOREY_BRUSHES, TERRAIN_BRUSHES } from '../../lists'
import { getSurfaceNames } from '../rules/board/surface'
import { liftPiece } from '../rules/board/piece'
import { makeCampaignCharacter } from '../../factories'
import { getHeight } from '../../character/rules/size'
import { FALL } from '../../tables'
import { addLevel, editPiece, laySurface, movePiece, paintTerrain, placePiece, turnPiece } from './board'

// A shed: walls on two cells and a floor over them, laid on a map whose own
// ground is painted around and under it.
const shed = StructureSchema.parse({
  name: 'shed',
  terrain: { '0,0': { blocking: true }, '1,0': { elevation: 1 } },
  levels: [{ floor: 3, terrain: { '0,0': {}, '1,0': { hole: true } } }],
})
const anchor = { q: 0, r: 0 }

const map = (): SceneState => SceneStateSchema.parse({
  board: BoardSchema.parse({ extent: { q: 5, r: 5, s: 5 }, terrain: { '0,0': { difficult: true }, '1,0': { soft: true }, '2,0': { visibility: 'bad' } } }),
})
const laid = () => placePiece('shed', shed, anchor, 0)(map())

// The table's ruling: a piece is painted on the map itself, as the house it
// is, and the map's own ground under it and around it is never changed by it.
describe('editing a piece on the map', () => {
  for (const brush of TERRAIN_BRUSHES) {
    for (const cell of [anchor, { q: 2, r: 0 }]) {
      it(`leaves the map's own ground as it was for ${brush} at ${cell.q},${cell.r}`, () => {
        const edited = editPiece('shed', paintTerrain(cell, brush, 1))(laid())
        expect(liftPiece(edited.board!, 'shed').terrain).toEqual(map().board!.terrain)
      })
    }
  }

  for (const brush of STOREY_BRUSHES) {
    it(`paints the piece's storey and leaves the map's own ground for ${brush}`, () => {
      const edited = editPiece('shed', paintTerrain({ q: 1, r: 0 }, brush, 0, 0))(laid())
      expect(liftPiece(edited.board!, 'shed').terrain).toEqual(map().board!.terrain)
    })
  }

  for (const name of getSurfaceNames()) {
    it(`leaves the map's own ground as it was when ${name} is laid on the piece`, () => {
      const edited = editPiece('shed', laySurface({ q: 1, r: 0 }, name, 0, null, 1))(laid())
      expect(liftPiece(edited.board!, 'shed').terrain).toEqual(map().board!.terrain)
    })
  }

  it('takes a cell painted beside it into the piece', () => {
    const edited = editPiece('shed', paintTerrain({ q: 2, r: 0 }, 'wall'))(laid())
    expect(edited.board!.terrain['2,0'].piece).toBe('shed')
  })

  it('lays a storey on the piece, not on the map', () => {
    const edited = editPiece('shed', addLevel())(laid())
    expect(edited.board!.levels.map((l) => l.piece)).toEqual(['shed', 'shed'])
  })
})

// Turning and moving a piece and back again leaves the map as it was.
describe('turning and moving a piece', () => {
  for (const steps of [1, 2, 3, 4, 5]) {
    it(`turns back to where it was after ${steps} turns each way`, () => {
      expect(turnPiece('shed', -steps)(turnPiece('shed', steps)(laid()))).toEqual(laid())
    })
  }

  it('moves back to where it was', () => {
    expect(movePiece('shed', anchor)(movePiece('shed', { q: -2, r: 1 })(laid()))).toEqual(laid())
  })
})

// A piece is not laid over someone standing on the board.
describe('laying a piece over someone', () => {
  it('is refused', () => {
    const ana = makeCampaignCharacter({ id: 'ana', name: 'Ana' })
    const stood = SceneStateSchema.parse({ ...map(), characters: { ana }, board: { ...map().board, placements: { ana: { cell: { q: 1, r: 0 } } } } })
    expect(placePiece('shed', shed, anchor, 0)(stood)).toEqual(stood)
  })

  it('is laid with a storey over someone standing under it', () => {
    const ana = makeCampaignCharacter({ id: 'ana', name: 'Ana' })
    const stood = SceneStateSchema.parse({ ...map(), characters: { ana }, board: { ...map().board, placements: { ana: { cell: { q: 1, r: 1 } } } } })
    const tree = StructureSchema.parse({ name: 'tree', terrain: { '0,0': { blocking: true } }, levels: [{ floor: getHeight(ana) + FALL.minHeight, terrain: { '0,0': { lattice: true }, '0,1': { lattice: true } } }] })
    expect(placePiece('tree', tree, { q: 1, r: 0 }, 0)(stood).board!.pieces.tree).toBeDefined()
  })
})
