import type { CombatState, Coord } from '../types'
import { getHeldLight } from '../../item/rules/items'
import { coordKey, distance } from '../geometry'
import { getPlacedFootprint, seesAcross } from './board'

// combat.tex "Darkness and light": "In a situation of darkness, the field of
// vision is determined by the light source ... Anyone in the light radius is
// visible and anyone out is not." Dark ground is painted on the board; light
// comes from what is held in hand or lies on the floor, and walls cast
// shadow.

type Light = { cells: Coord[]; radius: number }

function getLights(state: CombatState): Light[] {
  const held = Object.values(state.characters).flatMap((c) => {
    const radius = getHeldLight(c)
    const cells = radius === null ? null : getPlacedFootprint(state, c.id)
    return cells && radius !== null ? [{ cells, radius }] : []
  })
  const lying = state.floor.flatMap(({ item, cell }) => (item.light !== null && cell ? [{ cells: [cell], radius: item.light }] : []))
  return [...held, ...lying]
}

// Whether the cell is dark ground no light reaches.
export function isUnlit(state: CombatState, cell: Coord): boolean {
  const board = state.board
  if (!board?.terrain[coordKey(cell)]?.dark) return false
  return !getLights(state).some((l) => l.cells.some((at) => distance(at, cell) <= l.radius) && seesAcross(board, l.cells, [cell]))
}

// Whether the character stands wholly in the dark, out of every light.
export function isInDarkness(state: CombatState, id: string): boolean {
  const footprint = getPlacedFootprint(state, id)
  return !!footprint && footprint.every((cell) => isUnlit(state, cell))
}
