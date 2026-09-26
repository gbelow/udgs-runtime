import type { Character } from '../../types'
import type { CombatState, Coord, MoveAction, Placement } from '../types'
import { getSize } from '../../character/rules/misc'
import { coordKey } from '../geometry'
import { getFootprint, getOccupancy } from './board'

// creating.tex "Size and Space Occupation": "Two creatures of size 3 can
// occupy the same space, but cannot end a turn like that. A creature can
// occupy the same space as another of two sizes higher than itself." A
// footprint may be walked through anyone's cells but may only come to rest
// on cells free of everyone within a size of it.
export type Ground = {
  blocked: (cell: Coord) => boolean
  liquid: (cell: Coord) => boolean
  sharedBy: (cell: Coord) => string[]
}

export function readGround(state: CombatState, mover: string): Ground | null {
  const board = state.board
  if (!board) return null
  const occupancy = getOccupancy(board, state.characters)
  return {
    blocked: (cell) => !!board.terrain[coordKey(cell)]?.blocking,
    liquid: (cell) => !!board.terrain[coordKey(cell)]?.liquid,
    sharedBy: (cell) => (occupancy[coordKey(cell)] ?? []).filter((id) => id !== mover),
  }
}

// Off blocking cells, and in the water exactly when swimming.
export function isCrossable(footprint: Coord[], ground: Ground, movement: MoveAction['movement']): boolean {
  return !footprint.some(ground.blocked) && footprint.some(ground.liquid) === (movement === 'swim')
}

export function canRest(state: CombatState, c: Character, footprint: Coord[], ground: Ground): boolean {
  return footprint.every((cell) =>
    ground.sharedBy(cell).every((id) => {
      const other = state.characters[id]
      return other !== undefined && Math.abs(getSize(other) - getSize(c)) >= 2
    }),
  )
}

// Whether a footprint may be put down here outside of any move: off
// blocking cells and free of everyone within a size. What a placement by
// hand has to respect.
export function canStandAt(state: CombatState, id: string, placement: Placement): boolean {
  const c = state.characters[id]
  const ground = readGround(state, id)
  if (!c || !ground) return false
  const footprint = getFootprint(c, placement)
  return !footprint.some(ground.blocked) && canRest(state, c, footprint, ground)
}
