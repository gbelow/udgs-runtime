import type { Item } from '../../types'
import type { Term } from '../../character/rules/terms'
import type { AttackAction, Coord, CombatState, ExplosionAction, FloorItem } from '../types'
import { setDistance } from '../geometry'
import { getAimableCells, getPlacedFootprint, getShotReachOf, getStrikeReach, isAimableCell } from './board'
import { getObjectPart } from './equipment'
import { getImpactExplosion } from './explosion'
import { findFloorItem } from './floor'
import { getBurnOf } from './ignition'
import { hasUnlitFuel } from './hazard'
import { isSweep } from './sweep'

// A strike or a shot aimed at the ground: an item lying on the floor, named
// by `object`, or a space, named by `cell`; the attack has no target
// character. The ground cannot defend itself, so the blow is scored against a
// DL alone; it does something only to an object with a RES to test or a
// charge that goes off on impact, or, carrying burning damage, to fuel.

// The item an attack on the floor is aimed at.
export function getFloorObject(state: CombatState, attack: Pick<AttackAction, 'targetId' | 'object'>): FloorItem | null {
  return attack.targetId === null && attack.object !== '' ? findFloorItem(state, attack.object) : null
}

// The space of the ground the attack is aimed at, or lands on: the cell of
// the item, else the cell named.
export function getGroundCell(state: CombatState, attack: Pick<AttackAction, 'targetId' | 'object' | 'cell'>): Coord | null {
  return attack.targetId === null ? getFloorObject(state, attack)?.cell ?? attack.cell : null
}

// combat.tex "Immobile": "The DL to hit an immobile target is -5-1*SM". An
// object is immobile, and its bulk stands for its size: a human-sized object
// is bulk 5 and a small one 1; a space of the ground is -5, all of them (the
// table's rulings).
export function getGroundDL(state: CombatState, attack: Pick<AttackAction, 'targetId' | 'object' | 'cell'>): Term[] {
  const floor = getFloorObject(state, attack)
  if (floor) return [{ label: 'object', value: -floor.item.bulk }]
  return attack.cell ? [{ label: 'cell', value: -5 }] : []
}

// spells.tex "Charged": a blow that lands on a charge with the impact trigger
// sets it off where it lies (or a mundane explosive, gear.tex "Grenade").
export function getAttackExplosion(state: CombatState, attack: AttackAction, found: FloorItem, fields: Pick<ExplosionAction, 'id'> & Partial<ExplosionAction> = { id: '' }): ExplosionAction | null {
  return found.cell ? getImpactExplosion(state, attack.actorId, found.item, found.cell, fields) : null
}

// gear.tex "Equipment Breakage": a whole object with a RES can break, when
// the fight plays by the optional rule.
function isBreakable(state: CombatState, item: Item): boolean {
  return state.breakage && !item.broken && getObjectPart(item) !== null
}

// Whether a blow on the item would do anything.
function isWorthHitting(state: CombatState, attack: AttackAction, found: FloorItem): boolean {
  return !found.item.broken && (isBreakable(state, found.item) || getAttackExplosion(state, attack, found) !== null)
}

// Within the row's reach of the actor — a strike's, or a shot's carry, in
// sight; any item on a fight without a board, where the floor is one pile.
function isInFloorReach(state: CombatState, attack: AttackAction, found: FloorItem): boolean {
  const footprint = getPlacedFootprint(state, attack.actorId)
  if (!state.board || !footprint || found.cell === null) return true
  if (attack.kind === 'shoot') return isAimableCell(state.board, footprint, getShotReachOf(state, attack) ?? Infinity, found.cell)
  const reach = getStrikeReach(state, attack)
  return reach === null || setDistance(footprint, [found.cell]) <= reach
}

// A plain strike, never an opportunity attack or a sweep (the table's ruling:
// a sweep does not include the floor), or a shot.
function mayAimAtGround(attack: AttackAction): boolean {
  return attack.kind === 'shoot' || !(attack.opportunity || attack.sweepOf !== null || isSweep(attack))
}

// The items on the floor an attack as declared can be aimed at.
export function getFloorTargets(state: CombatState, attack: AttackAction): FloorItem[] {
  if (!mayAimAtGround(attack)) return []
  return state.floor.filter((f) => isInFloorReach(state, attack, f) && isWorthHitting(state, attack, f))
}

// combat.tex "Fire": burning damage lights fuel, so the spaces within reach
// that hold fuel not yet alight are worth aiming a burning attack at.
export function getCellTargets(state: CombatState, attack: AttackAction): Coord[] {
  if (!mayAimAtGround(attack) || getBurnOf(state, attack) <= 0) return []
  const reach = attack.kind === 'shoot' ? getShotReachOf(state, attack) : getStrikeReach(state, attack)
  return reach === null ? [] : getAimableCells(state, attack.actorId, reach).filter((cell) => hasUnlitFuel(state, cell))
}
