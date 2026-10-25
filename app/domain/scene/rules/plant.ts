import type { Character, Item } from '../../types'
import type { Coord, PlantAction, SceneState } from '../types'
import { hasGrant } from '../../character/rules/effects'
import { getItemWeapon } from '../../item/rules/items'
import { getPlacedFootprint } from './board/board'
import { ring, sameCell, setDistance } from './board/geometry'

// abilities.tex "Crossbow and Shield": "Allows the character to be in cover
// with a body shield while reloading a crossbow or arbalest. The shield is
// planted like a cover against everything in a 180 degree arc. Taking the
// shield back costs 1 standard action too." Planted, the shield lies in the
// planter's space facing a cell next to them, and covers them, and nobody
// else, whenever they stand there (`getBodyCoverToward`); taking it back is
// picking it up.

export function isBodyShield(item: Item): boolean {
  return !item.broken && getItemWeapon(item)?.shield?.body === true
}

// The body shields in hand that the character may plant: none for one who has
// not learned to.
export function getPlantableShields(c: Character): Item[] {
  return hasGrant(c, 'plantShield') ? c.held.filter(isBodyShield) : []
}

// The cells a planted shield may face: those next to the planter.
export function getPlantCells(state: SceneState, actorId: string): Coord[] {
  const footprint = getPlacedFootprint(state, actorId)
  if (!state.board || !footprint) return []
  const near = footprint.flatMap((cell) => ring(cell, 1))
  return near.filter((cell, i) => setDistance([cell], footprint) === 1 && near.findIndex((c) => sameCell(c, cell)) === i)
}

export function isPlantDeclared(state: SceneState, c: Character, action: PlantAction): boolean {
  const { to } = action
  return getPlantableShields(c).some((i) => i.id === action.itemId) && to !== null && getPlantCells(state, action.actorId).some((cell) => sameCell(cell, to))
}
