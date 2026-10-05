import type { Item } from '../../types'
import type { Term } from '../../character/rules/terms'
import type { AttackAction, Coord, CombatState, ExplosionAction, FloorItem } from '../types'
import { setDistance } from '../geometry'
import { getPlacedFootprint, getShotReachOf, getStrikeReach, isAimableCell } from './board'
import { getObjectPart } from './equipment'
import { getImpactExplosion } from './explosion'
import { findFloorItem } from './floor'
import { getBurnOf } from './ignition'
import { getCellFuels } from './hazard'
import { isSweep } from './sweep'

// A strike or a shot aimed at an item on the floor: `object` names it and the
// attack has no target character. An object cannot defend itself, so the blow
// is scored against a DL alone; it does something only to an object with a RES
// to test or a charge that goes off on impact.

// The item an attack on the floor is aimed at.
export function getFloorObject(state: CombatState, attack: Pick<AttackAction, 'targetId' | 'object'>): FloorItem | null {
  return attack.targetId === null && attack.object !== '' ? findFloorItem(state, attack.object) : null
}

// combat.tex "Immobile": "The DL to hit an immobile target is -5-1*SM". An
// object is immobile, and its bulk stands for its size: a human-sized object
// is bulk 5 and a small one 1 (the table's ruling).
export function getFloorAttackDL(item: Item): Term[] {
  return [{ label: 'object', value: -item.bulk }]
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

// combat.tex "Fire": burning damage lights the fuel where it lands, so a blow
// that carries burn on an item standing in unlit fuel does something.
function lightsFuel(state: CombatState, attack: AttackAction, found: FloorItem): boolean {
  return found.cell !== null && getBurnOf(state, attack) > 0 && getCellFuels(state, found.cell).length > 0
}

// Whether a blow on the item would do anything.
function isWorthHitting(state: CombatState, attack: AttackAction, found: FloorItem): boolean {
  return !found.item.broken && (isBreakable(state, found.item) || getAttackExplosion(state, attack, found) !== null || lightsFuel(state, attack, found))
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

// The items on the floor an attack as declared can be aimed at: the blow of a
// plain strike, never an opportunity attack or a sweep (the table's ruling: a
// sweep does not include floor items), or a shot.
export function getFloorTargets(state: CombatState, attack: AttackAction): FloorItem[] {
  if (attack.kind === 'strike' && (attack.opportunity || attack.sweepOf !== null || isSweep(attack))) return []
  return state.floor.filter((f) => isInFloorReach(state, attack, f) && isWorthHitting(state, attack, f))
}

// Where an attack lands: the cells of the item it was aimed at, or of the
// character it was.
export function getStruckCells(state: CombatState, attack: AttackAction): Coord[] {
  const floor = getFloorObject(state, attack)
  if (floor) return floor.cell ? [floor.cell] : []
  return attack.targetId ? getPlacedFootprint(state, attack.targetId) ?? [] : []
}
