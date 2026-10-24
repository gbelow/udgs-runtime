import type { Character } from '../../../types'
import type { SceneState, Coord, MoveAction, Placement } from '../../types'
import { getSize } from '../../../character/rules/size'
import { hasAffliction } from '../../../character/rules/afflictions'
import { coordKey } from './geometry'
import { getFootprint, getOccupancy } from './board'

// creating.tex "Size and Space Occupation": "Two creatures of size 3 can
// occupy the same space, but cannot end a turn like that. A creature can
// occupy the same space as another of two sizes higher than itself." A
// footprint may be walked through anyone's cells but may only come to rest
// on cells free of everyone within a size of it.
export type Ground = {
  blocked: (cell: Coord) => boolean
  liquid: (cell: Coord) => boolean
  elevation: (cell: Coord) => number
  sharedBy: (cell: Coord) => string[]
}

// `landing` holds where others are bound to come to rest as well as where they
// stand now (`getStrikeLandings`).
export function readGround(state: SceneState, mover: string, landing: Record<string, Placement> = {}): Ground | null {
  const board = state.board
  if (!board) return null
  const occupancy = getOccupancy(board, state.characters)
  const bound = getOccupancy({ ...board, placements: landing }, state.characters)
  return {
    blocked: (cell) => !!board.terrain[coordKey(cell)]?.blocking,
    liquid: (cell) => !!board.terrain[coordKey(cell)]?.liquid,
    elevation: (cell) => board.terrain[coordKey(cell)]?.elevation ?? 0,
    sharedBy: (cell) => [...new Set([...(occupancy[coordKey(cell)] ?? []), ...(bound[coordKey(cell)] ?? [])])].filter((id) => id !== mover),
  }
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

export function canRest(state: SceneState, c: Character, footprint: Coord[], ground: Ground): boolean {
  return getCrowdedBy(state, c, footprint, ground) === null
}

// Whoever in the footprint is within a size of the character, so that they
// may not both rest there (creating.tex "Size and Space Occupation"); null
// for nobody.
export function getCrowdedBy(state: SceneState, c: Character, footprint: Coord[], ground: Ground): string | null {
  for (const cell of footprint) {
    const crowding = ground.sharedBy(cell).find((id) => {
      const other = state.characters[id]
      return other === undefined || Math.abs(getSize(other) - getSize(c)) < 2
    })
    if (crowding !== undefined) return crowding
  }
  return null
}

// Whether a footprint may be put down here outside of any move: off
// blocking cells and free of everyone within a size. What a placement by
// hand has to respect.
export function canStandAt(state: SceneState, id: string, placement: Placement, landing: Record<string, Placement> = {}): boolean {
  const c = state.characters[id]
  const ground = readGround(state, id, landing)
  if (!c || !ground) return false
  const footprint = getFootprint(c, placement)
  return !footprint.some(ground.blocked) && canRest(state, c, footprint, ground)
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
