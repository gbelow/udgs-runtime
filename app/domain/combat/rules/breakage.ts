import type { ActionOf, AttackAction, BrokenItem, CombatState } from '../types'
import type { Delivery } from '../../types'
import { getBreakChance, getRowBreakTerms, type BreakingBlow } from '../../character/rules/breakage'
import { hasProperty } from '../../weaponProperties'
import { getDefendingReaction } from './attack'
import { getOpenAction } from './log'
import { findWeaponRow, type WeaponRow } from './weaponRow'

// gear.tex "Equipment Breakage": "Objects can deal and take damage whenever
// they collide with something else ... Cutting damage is dealt exclusively by
// the attacking object to its target, while impact is dealt to both." A blow
// that a block or a guard met on a graze or a miss struck the object in the
// way (combat.tex "Defend", "Guard"); on a hit or a critical it went past it.

// Why the fight's breakage setting cannot be changed: not while an action is
// open, whose dice were thrown for the setting as it stood.
export function getBreakageBar(state: CombatState): string | null {
  return getOpenAction(state) ? 'an action is open' : null
}

// The block or guard the attack was met with, while it stood in the blow's way.
export function getBreakingDefense(state: CombatState, root: AttackAction): ActionOf<'block' | 'guard'> | null {
  const degree = root.roll?.degree
  if (!state.breakage || (degree !== 'graze' && degree !== 'miss')) return null
  const reaction = getDefendingReaction(state, root)
  return reaction && (reaction.kind === 'block' || reaction.kind === 'guard') ? reaction : null
}

function getBlow(facts: Delivery | null): BreakingBlow | null {
  if (facts?.effect.type !== 'damage') return null
  const { damage, hardness, properties } = facts.effect.effect
  const total = (kind: 'blunt' | 'cut') => damage.filter((d) => d.kind === kind).reduce((sum, d) => sum + d.value, 0)
  return { blunt: total('blunt'), cut: total('cut'), hardness, piercing: hasProperty(properties, 'piercing') }
}

// An item a character holds that can give way: never a natural weapon, nor
// one already broken.
function getBreakable(row: WeaponRow | null): { itemId: string; RES: number; hardness: number } | null {
  if (!row || row.wielded.natural || row.wielded.broken) return null
  return { itemId: row.wielded.itemId, RES: row.atk.RES, hardness: getRowBreakTerms(row.atk).hardness }
}

function isBroken(blow: BreakingBlow, target: { RES: number; hardness: number } | null, roll: number): boolean {
  return target !== null && roll < getBreakChance(blow, target) * 100
}

// The items the attack broke as it landed, from the percentiles thrown with
// its roll: the object that met the blow takes its blunt and cutting damage;
// the attacker's weapon takes the impact back, and no cutting. A shot has no
// weapon of the shooter's to strike back with.
export function getBlowBreakage(state: CombatState, root: AttackAction, facts: Delivery | null): BrokenItem[] {
  const blow = getBlow(facts)
  const reaction = blow ? getBreakingDefense(state, root) : null
  const reactor = reaction ? state.characters[reaction.actorId] : undefined
  const attacker = state.characters[root.actorId]
  if (!reaction || !blow || !reactor || !attacker) return []

  const blockRow = findWeaponRow(reactor, reaction.weaponKey, reaction.attack)
  const met = getBreakable(blockRow)
  const swung = root.kind === 'strike' ? getBreakable(findWeaponRow(attacker, root.weaponKey, root.attack)) : null
  const impact: BreakingBlow | null = blockRow && { blunt: blow.blunt, cut: 0, ...getRowBreakTerms(blockRow.atk) }
  return [
    ...(met && isBroken(blow, met, root.breakRolls.defender) ? [{ ownerId: reactor.id, itemId: met.itemId }] : []),
    ...(swung && impact && isBroken(impact, swung, root.breakRolls.attacker) ? [{ ownerId: attacker.id, itemId: swung.itemId }] : []),
  ]
}
