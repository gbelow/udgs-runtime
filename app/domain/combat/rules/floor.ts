import type { Character, Item } from '../../types'
import type { CombatState, Coord, FloorItem, ShootAction } from '../types'
import { canHoldWith, getHeldItem } from '../../item/rules/hands'
import { getSize } from '../../character/rules/misc'
import { THROW_ITEM_RANGE } from '../../tables'
import { getAttackKind } from '../../weaponProperties'
import { findWeaponRow } from './weaponRow'
import { coordKey, disk, distance } from '../geometry'
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
  return item.amount > 1 ? { ...item, id: `${item.id}:${shot.id}`, amount: 1, charge: null } : item
}

// Whether the item can go into a free hand.
export function canPickUp(c: Character, item: Item): boolean {
  return canHoldWith(c, item, 1)
}

// combat.tex "Standard Action": what can be thrown as one — a free hand's,
// or lying in reach on the floor already — and what its bulk allows.
export function findThrowSource(state: CombatState, actorId: string, itemId: string): Item | null {
  if (!itemId) return null
  const held = state.characters[actorId]?.held.find((i) => i.id === itemId)
  return held ?? getReachableFloor(state, actorId).find((f) => f.item.id === itemId)?.item ?? null
}

// combat.tex "Standard Action": "bulk smaller than character size".
export function canThrowItem(c: Character, item: Item): boolean {
  return item.bulk < getSize(c)
}

// Every cell within 10m of the actor's footprint they can throw to — open
// ground, on the board.
export function getThrowCells(state: CombatState, actorId: string): Coord[] {
  const board = state.board
  const from = board?.placements[actorId]
  const footprint = getPlacedFootprint(state, actorId)
  if (!board || !from || !footprint) return []
  return disk(from.cell, THROW_ITEM_RANGE).filter((cell) => !board.terrain[coordKey(cell)]?.blocking)
}
