import { describe, it, expect } from 'vitest'
import { BoardSchema, SceneStateSchema, StructureSchema, type SceneState } from '../types'
import { BRUSH_RADIUS_MOST, TERRAIN_BRUSHES } from '../../lists'
import { layPiece } from '../rules/board/piece'
import type { TerrainBrush } from '../../types'
import { coordKey, disk, distance } from '../rules/board/geometry'
import { paintTerrain } from './board'

const centre = { q: 0, r: 0 }
const terrainAt = (s: SceneState, c: { q: number, r: number }) => s.board?.terrain[coordKey(c)]

// A stroke of a wide brush is one stroke: the cells it covers come out alike,
// and the cells it does not cover are left as they were.
describe('painting with a wide brush', () => {
  const toggling: TerrainBrush[] = ['wall', 'glass', 'water', 'rough', 'soft', 'dim', 'fog', 'dark']

  for (const brush of toggling) {
    it(`leaves the whole disk alike for ${brush}, even over cells already painted`, () => {
      const start: SceneState = SceneStateSchema.parse({ board: {} })
      const mixed = paintTerrain({ q: 1, r: 0 }, brush)(start)
      for (const s of [paintTerrain(centre, brush, 1)(mixed), paintTerrain(centre, brush, 1)(paintTerrain(centre, brush, 1)(mixed))]) {
        const cells = disk(centre, 1).map((c) => terrainAt(s, c))
        for (const cell of cells) expect(cell).toEqual(cells[0])
      }
    })
  }

  it('touches nothing beyond its radius', () => {
    const start: SceneState = SceneStateSchema.parse({ board: {} })
    const s = paintTerrain(centre, 'raise', 2)(start)
    for (const c of disk(centre, BRUSH_RADIUS_MOST + 1)) {
      expect(terrainAt(s, c) !== undefined).toBe(distance(centre, c) <= 2)
    }
  })

  it('reaches no further than the most a brush may', () => {
    const start: SceneState = SceneStateSchema.parse({ board: { extent: { q: 12, r: 12, s: 12 } } })
    const s = paintTerrain(centre, 'raise', BRUSH_RADIUS_MOST + 5)(start)
    expect(terrainAt(s, { q: BRUSH_RADIUS_MOST + 1, r: 0 })).toBeUndefined()
  })
})

// The table's ruling: the map's brushes paint the map's own ground, and a cell
// of a piece laid on it is left as it is.
describe('painting over a piece', () => {
  it('leaves every cell of the piece alone, for every brush', () => {
    const shed = StructureSchema.parse({ name: 'shed', terrain: { '0,0': { blocking: true, RES: 5 } } })
    const start = SceneStateSchema.parse({ board: layPiece(BoardSchema.parse({}), 'shed', shed, centre, 0)! })
    for (const brush of TERRAIN_BRUSHES) {
      expect(terrainAt(paintTerrain(centre, brush, 1)(start), centre)).toEqual(terrainAt(start, centre))
    }
  })
})
