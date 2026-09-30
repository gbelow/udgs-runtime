import type { Character, Item } from '../../types'
import type { CombatState, Coord, FloorItem, ShootAction } from '../types'
import { canHoldWith, getHeldItem } from '../../item/rules/hands'
import { getAttackKind } from '../../weaponProperties'
import { findWeaponRow } from './weaponRow'
import { distance } from '../geometry'
import { getPlacedFootprint } from './board'

export function onFloor(item: Item, cell: Coord | null): FloorItem {
  return { item, cell }
}

// What can be picked up: what lies on the character's own cells or next
// to them — anything, on a fight without a board, where the floor is one
// pile.
export function getReachableFloor(state: CombatState, id: string): FloorItem[] {
  const footprint = getPlacedFootprint(state, id)
  if (!state.board || !footprint) return state.floor
  return state.floor.filter((f) => f.cell === null || footprint.some((cell) => distance(cell, f.cell!) <= 1))
}

// Who a floor item is, wherever it lies; null for anything not on the floor.
export function findFloorItem(state: CombatState, itemId: string): FloorItem | null {
  if (!itemId) return null
  return state.floor.find((f) => f.item.id === itemId) ?? null
}

// combat.tex "Throw": what a thrown row sends to the floor — the weapon, or
// one of a stack of them, emptied of any charge it went off with; nothing
// for a shot or a natural weapon.
export function getThrownItem(state: CombatState, shot: ShootAction): Item | null {
  const shooter = state.characters[shot.actorId]
  const row = shooter ? findWeaponRow(shooter, shot.weaponKey, shot.attack) : null
  const item = shooter && row && !row.wielded.natural ? getHeldItem(shooter, row.wielded.itemId) : undefined
  if (!item || !row || getAttackKind(row.atk.range) !== 'throw') return null
  return item.amount > 1 ? { ...takeOne(item, shot.id), charge: null } : item
}

// One of a stack, split off under an id of its own named after the action
// that took it; the item itself when it is the last.
export function takeOne(item: Item, actionId: string): Item {
  return item.amount > 1 ? { ...item, id: `${item.id}:${actionId}`, amount: 1 } : item
}

// Whether the item can go into a free hand.
export function canPickUp(c: Character, item: Item): boolean {
  return canHoldWith(c, item, 1)
}

// One of a floor stack gone — thrown away, or destroyed by the charge it
// went off with; what is left of the stack carries no charge (spells.tex
// "Charged": the spell activates one object).
export function withoutOne(floor: FloorItem[], itemId: string): FloorItem[] {
  return floor.flatMap((f) => (f.item.id !== itemId ? [f] : f.item.amount > 1 ? [{ ...f, item: { ...f.item, amount: f.item.amount - 1, charge: null } }] : []))
}
