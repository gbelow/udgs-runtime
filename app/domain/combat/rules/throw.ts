import type { Character, Item } from '../../types'
import type { CombatState, Coord, ThrowAction } from '../types'
import { type AttackVariant, needsFocus } from '../../character/rules/gear'
import { type ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { getSize } from '../../character/rules/misc'
import { getWieldedWeapons } from '../../item/rules/hands'
import { SHOTS, THROW_ITEM_RANGE } from '../../tables'
import { getAttackKind } from '../../weaponProperties'
import { getAimableCells, getPlacedFootprint, isAimableCell } from './board'
import { findRowVariant, isRowUsable } from './weaponRow'
import { getReachableFloor, takeOne } from './floor'
import { isTying } from './tether'

// combat.tex "Throw", "Standard Action": an item thrown to a cell on the
// floor. A held weapon with a throwing row its thrower can fire is thrown
// with that row, at its reach and its price ("Throw: Basic ranged attack
// with a throwable weapon"); anything else small enough as a standard
// action.

// The throwing row a held item is thrown with, as its basic variation;
// null for an item with none the thrower can fire right now — one on the
// floor, or held with no focus surge made (combat.tex "Focus surge").
export function getThrowVariant(c: Character, itemId: string): AttackVariant | null {
  const wielded = getWieldedWeapons(c).find((w) => !w.natural && w.itemId === itemId)
  const atk = wielded?.weapon.attacks.find((a) => getAttackKind(a.range) === 'throw')
  if (!wielded || !atk) return null
  const row = { wielded, weapon: wielded.weapon, atk }
  return isRowUsable(c, row) && !needsFocus(atk, c) ? findRowVariant(c, row, SHOTS.shoot.variant) : null
}

// Whether the item can be thrown: as a standard action, "bulk smaller than
// character size" (combat.tex "Standard Action"), or with a throwing row.
export function canThrowItem(c: Character, item: Item): boolean {
  return item.bulk < getSize(c) || getThrowVariant(c, item.id) !== null
}

// Everything the character could pick to throw: what they hold, and what
// lies in reach on the floor.
export function getThrowables(state: CombatState, c: Character): Item[] {
  return [...c.held, ...getReachableFloor(state, c.id).map((f) => f.item)]
}

export function findThrowSource(state: CombatState, actorId: string, itemId: string): Item | null {
  const c = state.characters[actorId]
  return (itemId && c ? getThrowables(state, c).find((i) => i.id === itemId) : null) ?? null
}

export function getThrowCost(c: Character, itemId: string): ActionCost {
  const row = getThrowVariant(c, itemId)
  return row ? { AP: row.AP, STA: row.STA } : getActionCost(c, 'standardAction')
}

function getThrowReach(c: Character, itemId: string): number {
  return getThrowVariant(c, itemId)?.reach ?? THROW_ITEM_RANGE
}

// Every cell the item can be thrown to, and whether one is.
export function getThrowCells(state: CombatState, actorId: string, itemId: string): Coord[] {
  const thrower = state.characters[actorId]
  return thrower ? getAimableCells(state, actorId, getThrowReach(thrower, itemId)) : []
}

export function isThrowCell(state: CombatState, actorId: string, itemId: string, cell: Coord): boolean {
  const thrower = state.characters[actorId]
  const footprint = getPlacedFootprint(state, actorId)
  return !!state.board && !!thrower && !!footprint && isAimableCell(state.board, footprint, getThrowReach(thrower, itemId), cell)
}

// What lands where it was aimed: one of the stack, carrying the charge,
// since the spell activates one object (spells.tex "Charged").
export function getThrownUnit(state: CombatState, action: ThrowAction): Item | null {
  const item = findThrowSource(state, action.actorId, action.itemId)
  return item && !isTying(item) ? takeOne(item, action.id) : null
}
