import type { Character, Item } from '../../types'
import type { CombatState, Coord, FloorItem, ShootAction } from '../types'
import { canHoldWith, getHeldItem } from '../../item/rules/hands'
import { getAttackKind } from '../../weaponProperties'
import { findWeaponRow } from './weaponRow'
import { distance } from '../geometry'
import { getPlacedFootprint } from './board'

// Something put down: lying on the floor it is nobody's, so nothing a
// grappler seized stays seized.
export function onFloor(item: Item, cell: Coord | null): FloorItem {
  return { item: { ...item, seized: false }, cell }
}

// What can be picked up: what lies on the character's own cells or next
// to them — anything, on a fight without a board, where the floor is one
// pile.
export function getReachableFloor(state: CombatState, id: string): FloorItem[] {
  const footprint = getPlacedFootprint(state, id)
  if (!state.board || !footprint) return state.floor
  return state.floor.filter((f) => f.cell === null || footprint.some((cell) => distance(cell, f.cell!) <= 1))
}

// combat.tex "Throw": what a thrown row sends to the floor — the weapon, or
// one of a stack of them, emptied of any charge it went off with; nothing
// for a shot or a natural weapon.
export function getThrownItem(state: CombatState, shot: ShootAction): Item | null {
  const shooter = state.characters[shot.actorId]
  const row = shooter ? findWeaponRow(shooter, shot.weaponKey, shot.attack) : null
  const item = shooter && row && !row.wielded.natural ? getHeldItem(shooter, row.wielded.itemId) : undefined
  if (!item || !row || getAttackKind(row.atk.range) !== 'throw') return null
  return item.amount > 1 ? { ...item, id: `${item.id}:${shot.id}`, amount: 1, charge: null } : item
}

// Whether the item can go into a free hand.
export function canPickUp(c: Character, item: Item): boolean {
  return canHoldWith(c, item, 1)
}
