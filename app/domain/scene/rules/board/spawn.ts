import { PlacementSchema, type Coord, type Placement, type SceneState } from '../../types'
import { isCombatStarted } from '../started'
import { getOpenAction } from '../log'
import { isOffGrid } from '../parked'
import { getFightName } from '../fighters'
import { coordKey } from './geometry'
import { getFootprint, placeAt } from './board'
import { canStandAt } from './ground'

// The spawn areas of a prepared scene (the user's ruling, 2026-11-23): each
// of its parties is placed by hand in the area the scene painted for it over
// its battle map, until the fight starts. A party the scene painted none for
// is placed anywhere, and once the fight has started nobody is placed by hand
// but whoever was never placed, and they stand where they may.

// The cells (by key) the character is placed in now: their party's area,
// while the fight has not started; null for anywhere.
export function getSpawnArea(state: SceneState, id: string): string[] | null {
  const party = state.partyOf[id]
  const area = party === undefined ? undefined : state.spawnOf[party]
  if (!state.board || !area || area.length === 0 || isCombatStarted(state)) return null
  return area
}

// Whether the placement keeps the character to their spawn area, if they have
// one: every cell of their footprint in it.
function keepsToSpawnArea(state: SceneState, id: string, placement: Placement): boolean {
  const area = getSpawnArea(state, id)
  const c = state.characters[id]
  if (area === null) return true
  if (!c) return false
  return getFootprint(c, placement).every((cell) => area.includes(coordKey(cell)))
}

// Where the character would stand if put down by hand on the cell, as they
// are turned now.
export function getPlacementAt(state: SceneState, id: string, cell: Coord): Placement {
  return placeAt(state.board, state.board?.placements[id] ?? PlacementSchema.parse({}), cell)
}

// Why the character may not be put down by hand on the cell, null when they
// may: before the fight anywhere they may stand in their party's area, once
// it has started only if they were never placed.
export function getPlaceBar(state: SceneState, id: string, cell: Coord): string | null {
  const c = state.characters[id]
  if (!state.board || !c) return 'there is no board to place them on'
  const name = getFightName(state, id)
  if (state.board.placements[id] && isCombatStarted(state)) return `${name} is already on the board: once the fight has started they move by moving`
  if (getOpenAction(state)) return 'not while an action is open'
  if (isOffGrid(state, id)) return `${name} is off the board`
  const placement = getPlacementAt(state, id, cell)
  if (!keepsToSpawnArea(state, id, placement)) return c.footprint.length > 1 ? `all of ${name} must stand in their party's area` : `${name} must stand in their party's area`
  if (!canStandAt(state, id, placement)) return `there is no room for ${name} there`
  return null
}

// The parties with a spawn area while the fight has not started, in the order
// they joined it: the n-th is drawn in the n-th tint (from 1).
export function getSpawnParties(state: SceneState): string[] {
  if (!state.board || isCombatStarted(state)) return []
  return Object.keys(state.parties).filter((party) => (state.spawnOf[party]?.length ?? 0) > 0)
}
