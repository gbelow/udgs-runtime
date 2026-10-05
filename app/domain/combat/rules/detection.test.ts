import { describe, it, expect } from 'vitest'
import { CombatStateSchema, PlacementSchema, TerrainCellSchema, type Board, type CombatState, type Coord, type Direction } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { DIRECTIONS, ROTATIONS, add, turn } from '../geometry'
import { getSenseReaches } from './detection'

function fighter(id: string): CampaignCharacter {
  return { ...makeCampaignCharacter({ name: id }), id }
}

function fight(observerAt: { cell: Coord; orientation: Direction }, targetCell: Coord, terrain: Board['terrain'] = {}): CombatState {
  return {
    ...CombatStateSchema.parse({
      board: {
        placements: { o: PlacementSchema.parse(observerAt), t: PlacementSchema.parse({ cell: targetCell }) },
        terrain,
        origin: { q: 0, r: 0 },
        radius: 6,
      },
    }),
    characters: { o: fighter('o'), t: fighter('t') },
  }
}

const sensesReaching = (state: CombatState) => getSenseReaches(state, 'o', 't').map((r) => r.sense)
const origin = { q: 0, r: 0 }

describe('what an observer senses of a target', () => {
  // combat.tex "Vision": the field of vision is "the arc defined by the
  // directions of 3 adjacent hexes around a character".
  it.each(ROTATIONS)('sees the facing and the two hexes beside it, facing %i', (facing) => {
    const seen = ROTATIONS.filter((d) => sensesReaching(fight({ cell: origin, orientation: facing }, add(origin, DIRECTIONS[d]))).includes('vision'))
    expect(seen.sort()).toEqual([turn(facing, -1), facing, turn(facing, 1)].sort())
  })

  // combat.tex "Hearing": "omnidirectional".
  it.each(ROTATIONS)('hears every hex around it, facing %i', (facing) => {
    const heard = ROTATIONS.filter((d) => sensesReaching(fight({ cell: origin, orientation: facing }, add(origin, DIRECTIONS[d]))).includes('hearing'))
    expect(heard).toEqual([...ROTATIONS])
  })

  // combat.tex "Cover": "Cover blocks vision unless it is transparent".
  it('does not see past a wall, though it hears past it', () => {
    const wall = { '1,0': TerrainCellSchema.parse({ blocking: true }) }
    const state = fight({ cell: origin, orientation: 0 }, { q: 2, r: 0 }, wall)
    expect(sensesReaching(state)).toEqual(['hearing'])
    expect(sensesReaching(fight({ cell: origin, orientation: 0 }, { q: 2, r: 0 }))).toContain('vision')
  })

  // combat.tex "Visibility": "Zero visibility means that the target is
  // untargetable through vision."
  it('does not see a target standing in zero visibility', () => {
    const smoke = { '2,0': TerrainCellSchema.parse({ visibility: 'zero' }) }
    expect(sensesReaching(fight({ cell: origin, orientation: 0 }, { q: 2, r: 0 }, smoke))).not.toContain('vision')
  })

  it('reaches as it does on open ground when the fight has no board', () => {
    const placed = fight({ cell: origin, orientation: 0 }, { q: 1, r: 0 })
    expect(sensesReaching({ ...placed, board: null })).toEqual(sensesReaching(placed))
  })
})
