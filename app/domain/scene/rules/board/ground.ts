import type { Character } from '../../../types'
import type { SceneState, Coord, MoveAction, Placement } from '../../types'
import { hasAffliction } from '../../../character/rules/afflictions'
import { coordKey } from './geometry'
import { getFootprint, getOccupancy } from './board'

// The table's ruling on creating.tex "Size and Space Occupation": a footprint
// may be walked through anyone's cells, but two characters rest on one cell
// only when one of them is prone, whatever their sizes. The foot of a face
// someone hangs on is kept free for their fall.
export type Ground = {
  blocked: (cell: Coord) => boolean
  liquid: (cell: Coord) => boolean
  elevation: (cell: Coord) => number
  sharedBy: (cell: Coord) => string[]
  // whoever hangs on a face over the cell, whose fall would land on it
  heldFor: (cell: Coord) => string[]
}

// `landing` holds where others are bound to come to rest as well as where they
// stand now (`getStrikeLandings`).
export function readGround(state: SceneState, mover: string, landing: Record<string, Placement> = {}): Ground | null {
  const board = state.board
  if (!board) return null
  const occupancy = getOccupancy(board, state.characters)
  const bound = getOccupancy({ ...board, placements: landing }, state.characters)
  const elevation = (cell: Coord) => board.terrain[coordKey(cell)]?.elevation ?? 0
  const feet: Record<string, Placement> = {}
  for (const [id, placement] of Object.entries(board.placements)) {
    const foot = getHangingLanding(placement, elevation)
    if (foot) feet[id] = { ...placement, cell: foot }
  }
  const held = getOccupancy({ ...board, placements: feet }, state.characters)
  return {
    blocked: (cell) => !!board.terrain[coordKey(cell)]?.blocking,
    liquid: (cell) => !!board.terrain[coordKey(cell)]?.liquid,
    elevation,
    sharedBy: (cell) => [...new Set([...(occupancy[coordKey(cell)] ?? []), ...(bound[coordKey(cell)] ?? [])])].filter((id) => id !== mover),
    heldFor: (cell) => (held[coordKey(cell)] ?? []).filter((id) => id !== mover),
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
export function isCrossable(footprint: Coord[], ground: Ground, movement: MoveAction['movement'], fromWater = false): boolean {
  if (footprint.some(ground.blocked)) return false
  if (movement === 'swim') return footprint.some(ground.liquid) || fromWater
  return !fromWater || movement === 'climb' || movement === 'jump'
}

export function isWet(footprint: Coord[], ground: Ground): boolean {
  return footprint.some(ground.liquid)
}

// `lying`: the character comes to rest there prone.
export function canRest(state: SceneState, c: Character, footprint: Coord[], ground: Ground, lying: boolean): boolean {
  return getCrowdedBy(state, c, footprint, ground, lying) === null
}

// Whoever keeps the character from resting on the footprint: one hanging over
// it, or one standing in it while the character does not lie there either;
// null for nobody.
export function getCrowdedBy(state: SceneState, c: Character, footprint: Coord[], ground: Ground, lying: boolean): string | null {
  for (const cell of footprint) {
    const crowding = ground.heldFor(cell)[0] ?? ground.sharedBy(cell).find((id) => !lying && !isProne(state, id))
    if (crowding !== undefined) return crowding
  }
  return null
}

// Whether a footprint may be put down here outside of any move, the character
// as they are: off blocking cells and free to rest on. What a placement by
// hand has to respect.
export function canStandAt(state: SceneState, id: string, placement: Placement, landing: Record<string, Placement> = {}): boolean {
  const c = state.characters[id]
  const ground = readGround(state, id, landing)
  if (!c || !ground) return false
  const footprint = getFootprint(c, placement)
  return !footprint.some(ground.blocked) && canRest(state, c, footprint, ground, isProne(state, id))
}

// Someone stands in the space the character lies in, so they may not stand up
// there: they crawl out first, or bring the other down.
export function isStoodOver(state: SceneState, c: Character): boolean {
  const placement = state.board?.placements[c.id]
  const ground = readGround(state, c.id)
  return !!placement && !!ground && getFootprint(c, placement).some((cell) => ground.sharedBy(cell).some((id) => !isProne(state, id)))
}

export function isInLiquid(state: SceneState, c: Character): boolean {
  const placement = state.board?.placements[c.id]
  return !!placement && getFootprint(c, placement).some((cell) => state.board?.terrain[coordKey(cell)]?.liquid)
}

// combat.tex "Movement": swimming "also applies the prone condition" — for
// as long as the swimmer is in the water, on top of a prone they carry.
export function isProne(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && (hasAffliction(c, 'prone') || isInLiquid(state, c))
}
