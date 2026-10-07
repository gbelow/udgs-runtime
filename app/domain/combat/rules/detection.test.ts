import { describe, it, expect } from 'vitest'
import { CombatStateSchema, PlacementSchema, TerrainCellSchema, type Board, type CombatState, type Coord, type Direction } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema, type CampaignCharacter } from '../../types'
import { DIRECTIONS, ROTATIONS, add } from '../geometry'
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
const visionOf = (state: CombatState) => getSenseReaches(state, 'o', 't').find((r) => r.sense === 'vision')?.impairment ?? 'total'
const origin = { q: 0, r: 0 }

describe('what an observer senses of a target', () => {
  // combat.tex "Vision": "Vision requires light and line of sight" — no
  // field of vision, so whichever way the observer faces.
  it.each(ROTATIONS)('sees every hex around it, facing %i', (facing) => {
    const seen = ROTATIONS.filter((d) => sensesReaching(fight({ cell: origin, orientation: facing }, add(origin, DIRECTIONS[d]))).includes('vision'))
    expect(seen).toEqual([...ROTATIONS])
  })

  // combat.tex "Hearing": "triggered by a sound event", from anywhere.
  it.each(ROTATIONS)('hears every hex around it, facing %i', (facing) => {
    const heard = ROTATIONS.filter((d) => sensesReaching(fight({ cell: origin, orientation: facing }, add(origin, DIRECTIONS[d]))).includes('hearing'))
    expect(heard).toEqual([...ROTATIONS])
  })

  // combat.tex "Cover": "If a character is not within the line of sight of a
  // detector, they are considered at total impairment to vision."
  it('does not see past a wall, though it hears past it', () => {
    const wall = { '1,0': TerrainCellSchema.parse({ blocking: true }) }
    expect(sensesReaching(fight({ cell: origin, orientation: 0 }, { q: 2, r: 0 }, wall))).toEqual(['hearing'])
    expect(sensesReaching(fight({ cell: origin, orientation: 0 }, { q: 2, r: 0 }))).toContain('vision')
  })

  // combat.tex "Fog and smoke": opaque gas "makes them zero visibility to
  // those outside. Anyone inside the fog is in bad visibility to others
  // inside the 1m radius."
  it('does not see into fog from outside it, and sees partly within it close by', () => {
    const smoke = { '1,0': TerrainCellSchema.parse({ visibility: 'zero' }), '0,0': TerrainCellSchema.parse({ visibility: 'zero' }) }
    expect(visionOf(fight({ cell: { q: -1, r: 0 }, orientation: 0 }, { q: 1, r: 0 }, smoke))).toBe('total')
    expect(visionOf(fight({ cell: origin, orientation: 0 }, { q: 1, r: 0 }, smoke))).toBe('partial')
  })

  // combat.tex "Visibility": "Bad visibility means that those that rely on
  // vision get partial impairment".
  it('sees a target in bad visibility only partly', () => {
    const dim = { '2,0': TerrainCellSchema.parse({ visibility: 'bad' }) }
    expect(visionOf(fight({ cell: origin, orientation: 0 }, { q: 2, r: 0 }, dim))).toBe('partial')
  })

  // combat.tex "Afflictions": "Blind: ... Cannot use vision".
  it('does not see at all when blind', () => {
    const state = fight({ cell: origin, orientation: 0 }, { q: 1, r: 0 })
    const blind = { ...state, characters: { ...state.characters, o: { ...state.characters.o, afflictions: ['blind' as const] } } }
    expect(sensesReaching(blind)).not.toContain('vision')
  })

  // combat.tex "Camouflage": "an item necessary to turn an area into a
  // stealth area with bad visibility for a camouflaged character".
  it('sees a camouflaged target in the open only partly', () => {
    const state = fight({ cell: origin, orientation: 0 }, { q: 2, r: 0 })
    const cloak = ItemSchema.parse({ name: 'Camouflage', camouflage: -3 })
    const hidden = { ...state, characters: { ...state.characters, t: { ...state.characters.t, held: [cloak] } } }
    expect(visionOf(hidden)).toBe('partial')
  })

  it('reaches as it does on open ground when the fight has no board', () => {
    const placed = fight({ cell: origin, orientation: 0 }, { q: 1, r: 0 })
    expect(sensesReaching({ ...placed, board: null })).toEqual(sensesReaching(placed))
  })
})
