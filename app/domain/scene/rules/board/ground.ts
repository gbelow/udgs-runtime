import type { Character } from '../../../types'
import type { SceneState, Coord, MoveAction, Placement } from '../../types'
import { hasAffliction } from '../../../character/rules/afflictions'
import { coordKey } from './geometry'
import { FALL } from '../../../tables'
import { getFootprint, getOccupancy, getTerrainAt } from './board'

// The table's ruling on creating.tex "Size and Space Occupation": a footprint
// may be walked through anyone's cells, but two characters rest on one cell
// only when one of them is prone, whatever their sizes. The foot of a face
// someone hangs on is kept free for their fall.
//
// The ground as someone whose feet are at a height finds it (`getTerrainAt`):
// the floor each cell offers them, what stands on it, and who is on it with
// them, which nobody a cliff above or below is.
export type Floor = {
  blocked: (cell: Coord) => boolean
  liquid: (cell: Coord) => boolean
  elevation: (cell: Coord) => number
  sharedBy: (cell: Coord) => string[]
  // whoever hangs on a face over the cell, whose fall would land on it
  heldFor: (cell: Coord) => string[]
}

export type Ground = { at: (height: number) => Floor }

// `landing` holds where others are bound to come to rest as well as where they
// stand now (`getStrikeLandings`).
export function readGround(state: SceneState, mover: string, landing: Record<string, Placement> = {}): Ground | null {
  const board = state.board
  if (!board) return null
  const occupancy = getOccupancy(board, state.characters)
  const bound = getOccupancy({ ...board, placements: landing }, state.characters)
  const feetOf = (id: string) => landing[id]?.elevation ?? board.placements[id]?.elevation ?? 0
  const feet: Record<string, Placement> = {}
  for (const [id, placement] of Object.entries(board.placements)) {
    const foot = getHangingLanding(placement, (cell) => getTerrainAt(board, cell, placement.elevation).floor)
    if (foot) feet[id] = { ...placement, cell: foot }
  }
  const held = getOccupancy({ ...board, placements: feet }, state.characters)
  const floorAt = (height: number): Floor => {
    const footing = (cell: Coord) => getTerrainAt(board, cell, height)
    const near = (cell: Coord) => (id: string) => id !== mover && Math.abs(feetOf(id) - footing(cell).floor) < FALL.minHeight
    return {
      blocked: (cell) => !!footing(cell).terrain?.blocking,
      liquid: (cell) => !!footing(cell).terrain?.liquid,
      elevation: (cell) => footing(cell).floor,
      sharedBy: (cell) => [...new Set([...(occupancy[coordKey(cell)] ?? []), ...(bound[coordKey(cell)] ?? [])])].filter(near(cell)),
      heldFor: (cell) => (held[coordKey(cell)] ?? []).filter((id) => id !== mover),
    }
  }
  // a walk asks again and again from the few heights its feet are at
  const floors = new Map<number, Floor>()
  return {
    at: (height) => {
      if (!floors.has(height)) floors.set(height, floorAt(height))
      return floors.get(height)!
    },
  }
}

// combat.tex "Balance": the cell a climber hanging on a face falls into, the
// foot of the face; null for one not hanging.
export function getHangingLanding(placement: Placement, elevation: (cell: Coord) => number): Coord | null {
  if (!placement.climb) return null
  return elevation(placement.climb.to) > elevation(placement.cell) ? placement.cell : placement.climb.to
}

// Off blocking cells. A swim is in the water except for its step out onto dry
// ground (`fromWater`: the step before was wet). A move is made in the water
// or on land, never both, so any other movement stops at the first water it
// reaches: nothing follows a wet step but a climb out of it. A jump touches
// nothing between where it sets out and where it lands, so water it passes over
// does not stop it.
export function isCrossable(footprint: Coord[], floor: Floor, movement: MoveAction['movement'], fromWater = false): boolean {
  if (footprint.some(floor.blocked)) return false
  if (movement === 'swim') return footprint.some(floor.liquid) || fromWater
  return !fromWater || movement === 'climb' || movement === 'jump'
}

export function isWet(footprint: Coord[], floor: Floor): boolean {
  return footprint.some(floor.liquid)
}

// `lying`: the character comes to rest there prone.
export function canRest(state: SceneState, c: Character, footprint: Coord[], floor: Floor, lying: boolean): boolean {
  return getCrowdedBy(state, c, footprint, floor, lying) === null
}

// Whoever keeps the character from resting on the footprint: one hanging over
// it, or one standing in it while the character does not lie there either;
// null for nobody.
export function getCrowdedBy(state: SceneState, c: Character, footprint: Coord[], floor: Floor, lying: boolean): string | null {
  for (const cell of footprint) {
    const crowding = floor.heldFor(cell)[0] ?? floor.sharedBy(cell).find((id) => !lying && !isProne(state, id))
    if (crowding !== undefined) return crowding
  }
  return null
}

// Whether a footprint may be put down here outside of any move, the character
// as they are: off blocking cells and free to rest on. What a placement by
// hand has to respect.
export function canStandAt(state: SceneState, id: string, placement: Placement, landing: Record<string, Placement> = {}): boolean {
  const c = state.characters[id]
  const floor = readGround(state, id, landing)?.at(placement.elevation)
  if (!c || !floor) return false
  const footprint = getFootprint(c, placement)
  return !footprint.some(floor.blocked) && canRest(state, c, footprint, floor, isProne(state, id))
}

// Someone stands in the space the character lies in, so they may not stand up
// there: they crawl out first, or bring the other down.
export function isStoodOver(state: SceneState, c: Character): boolean {
  const placement = state.board?.placements[c.id]
  const floor = placement && readGround(state, c.id)?.at(placement.elevation)
  return !!placement && !!floor && getFootprint(c, placement).some((cell) => floor.sharedBy(cell).some((id) => !isProne(state, id)))
}

export function isInLiquid(state: SceneState, c: Character): boolean {
  const board = state.board
  const placement = board?.placements[c.id]
  return !!board && !!placement && getFootprint(c, placement).some((cell) => getTerrainAt(board, cell, placement.elevation).terrain?.liquid)
}

// combat.tex "Movement": swimming "also applies the prone condition" — for
// as long as the swimmer is in the water, on top of a prone they carry.
export function isProne(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && (hasAffliction(c, 'prone') || isInLiquid(state, c))
}
