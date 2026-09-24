import type { Character, Item } from '../../types'
import type { CombatState, Coord, FloorItem } from '../types'
import { canHoldWith } from '../../item/rules/hands'
import { distance } from '../geometry'
import { getPlacedFootprint } from './board'

// Something put down: lying on the floor it is nobody's, so nothing a
// grappler seized stays seized.
export function onFloor(item: Item, cell: Coord | null): FloorItem {
  return { item: { ...item, seized: false }, cell }
}

// combat.tex "Picking up": what lies on the character's own cells or next
// to them — anything, on a fight without a board, where the floor is one
// pile.
export function getReachableFloor(state: CombatState, id: string): FloorItem[] {
  const footprint = getPlacedFootprint(state, id)
  if (!state.board || !footprint) return state.floor
  return state.floor.filter((f) => f.cell === null || footprint.some((cell) => distance(cell, f.cell!) <= 1))
}

// Whether the item can go into a free hand.
export function canPickUp(c: Character, item: Item): boolean {
  return canHoldWith(c, item, 1)
}
