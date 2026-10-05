import type { Item } from '../../types'
import type { Term } from '../../character/rules/terms'
import type { CombatState, ExplosionAction, FloorItem, StrikeAction } from '../types'
import { setDistance } from '../geometry'
import { getPlacedFootprint, getStrikeReach } from './board'
import { getObjectPart } from './equipment'
import { getImpactExplosion } from './explosion'
import { findFloorItem } from './floor'
import { isSweep } from './sweep'

// A strike aimed at an item on the floor: `object` names it and the strike
// has no target character. An object cannot defend itself, so the blow is
// scored against a DL alone; it does something only to an object with a RES
// to test or a charge that goes off on impact.

// The item a strike on the floor is aimed at.
export function getFloorObject(state: CombatState, strike: Pick<StrikeAction, 'targetId' | 'object'>): FloorItem | null {
  return strike.targetId === null && strike.object !== '' ? findFloorItem(state, strike.object) : null
}

// combat.tex "Immobile": "The DL to hit an immobile target is -5-1*SM". An
// object is immobile, and its bulk stands for its size: a human-sized object
// is bulk 5 and a small one 1 (the table's ruling).
export function getFloorStrikeDL(item: Item): Term[] {
  return [{ label: 'object', value: -item.bulk }]
}

// spells.tex "Charged": a blow that lands on a charge with the impact trigger
// sets it off where it lies (or a mundane explosive, gear.tex "Grenade").
export function getStrikeExplosion(state: CombatState, strike: StrikeAction, found: FloorItem, fields: Pick<ExplosionAction, 'id'> & Partial<ExplosionAction> = { id: '' }): ExplosionAction | null {
  return found.cell ? getImpactExplosion(state, strike.actorId, found.item, found.cell, fields) : null
}

// gear.tex "Equipment Breakage": a whole object with a RES can break, when
// the fight plays by the optional rule.
function isBreakable(state: CombatState, item: Item): boolean {
  return state.breakage && !item.broken && getObjectPart(item) !== null
}

// Whether a blow on the item would do anything.
function isWorthStriking(state: CombatState, strike: StrikeAction, found: FloorItem): boolean {
  return !found.item.broken && (isBreakable(state, found.item) || getStrikeExplosion(state, strike, found) !== null)
}

// Within the melee row's reach of the actor; any item on a fight without a
// board, where the floor is one pile.
function isInFloorReach(state: CombatState, strike: StrikeAction, found: FloorItem): boolean {
  const footprint = getPlacedFootprint(state, strike.actorId)
  if (!state.board || !footprint || found.cell === null) return true
  const reach = getStrikeReach(state, strike)
  return reach === null || setDistance(footprint, [found.cell]) <= reach
}

// The items on the floor a strike as declared can be aimed at: the blow of a
// plain strike, never an opportunity attack or a sweep (the table's ruling: a
// sweep does not include floor items).
export function getFloorTargets(state: CombatState, strike: StrikeAction): FloorItem[] {
  if (strike.opportunity || strike.sweepOf !== null || isSweep(strike)) return []
  return state.floor.filter((f) => isInFloorReach(state, strike, f) && isWorthStriking(state, strike, f))
}
