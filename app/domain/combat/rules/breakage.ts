import type { ActionOf, AttackAction, BrokenItem, CombatState, StrikeAction } from '../types'
import type { Armor, Damage, Delivery, Item } from '../../types'
import { getBreakChance, getRowBreakTerms, type Breakable, type BreakingBlow } from '../../character/rules/breakage'
import { getHardness, getItemArmor } from '../../item/rules/items'
import { getUndefendedDamage, isArmorBare } from '../../character/rules/damage'
import { hasProperty } from '../../weaponProperties'
import { getDefendingReaction } from './attack'
import { outcomeOf } from './damage'
import { getHeldItem } from '../../item/rules/hands'
import { getWeakestPart, isObjectStrike } from './equipment'
import { getOpenAction } from './log'
import { getItemName } from './fighters'
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

// The armor item the target wears, while it is whole, and what it is.
function getWornArmor(state: CombatState, root: AttackAction): { item: Item; armor: Armor } | null {
  const item = root.targetId ? state.characters[root.targetId]?.worn : null
  const armor = item && !item.broken ? getItemArmor(item) : undefined
  return item && armor ? { item, armor } : null
}

// Whether the attack puts anything at risk, and so needs its percentiles: the
// object that meets it, or the armor worn.
export function needsBreakRolls(state: CombatState, root: AttackAction): boolean {
  return state.breakage && (isObjectStrike(root) || getBreakingDefense(state, root) !== null || getWornArmor(state, root) !== null)
}

function getBlow({ damage, hardness, properties }: Damage): BreakingBlow {
  const total = (kind: 'blunt' | 'cut') => damage.filter((d) => d.kind === kind).reduce((sum, d) => sum + d.value, 0)
  return { blunt: total('blunt'), cut: total('cut'), hardness, piercing: hasProperty(properties, 'piercing') }
}

// An item a character holds that can give way: never a natural weapon, nor
// one already broken.
function getBreakable(row: WeaponRow | null): (Breakable & { itemId: string }) | null {
  if (!row || row.wielded.natural || row.wielded.broken) return null
  return { itemId: row.wielded.itemId, RES: row.atk.RES, hardness: getRowBreakTerms(row.atk).hardness }
}

// An item a blow puts at risk: the percentile it is tested with, whose it is,
// and the chance it gives way. `swung` is the attacker's own weapon taking the
// impact back, `shield` an object blocked with that is a shield.
export type BreakRisk = {
  slot: keyof AttackAction['breakRolls']
  ownerId: string
  itemId: string
  chance: number
  swung: boolean
  shield: boolean
}

// The percentile is thrown 0 to 99 and an item breaks below chance x 100, so
// the odds that it does are the rolls under that bar.
export function getBreakOdds({ chance }: Pick<BreakRisk, 'chance'>): number {
  return Math.min(1, Math.ceil(chance * 100) / 100)
}

function isBroken(risk: BreakRisk, roll: number): boolean {
  return roll < risk.chance * 100
}

// The object that met the blow takes its blunt and cutting damage; the
// attacker's weapon takes the impact back, and no cutting. A shot has no
// weapon of the shooter's to strike back with.
function getObjectRisks(state: CombatState, root: AttackAction, blow: BreakingBlow): BreakRisk[] {
  const reaction = getBreakingDefense(state, root)
  const reactor = reaction ? state.characters[reaction.actorId] : undefined
  const attacker = state.characters[root.actorId]
  if (!reaction || !reactor || !attacker) return []

  const blockRow = findWeaponRow(reactor, reaction.weaponKey, reaction.attack)
  const met = getBreakable(blockRow)
  const swung = root.kind === 'strike' ? getBreakable(findWeaponRow(attacker, root.weaponKey, root.attack)) : null
  const impact: BreakingBlow | null = blockRow && { blunt: blow.blunt, cut: 0, ...getRowBreakTerms(blockRow.atk) }
  return [
    ...(met ? [{ slot: 'defender' as const, ownerId: reactor.id, itemId: met.itemId, chance: getBreakChance(blow, met), swung: false, shield: blockRow?.weapon.shield !== undefined }] : []),
    ...(swung && impact ? [{ slot: 'attacker' as const, ownerId: attacker.id, itemId: swung.itemId, chance: getBreakChance(impact, swung), swung: true, shield: false }] : []),
  ]
}

// The armor worn takes the damage that arrived past the defense, unless the
// blow found the body bare there.
function getArmorRisks(state: CombatState, root: AttackAction, facts: Delivery, damage: Damage): BreakRisk[] {
  const target = root.targetId ? state.characters[root.targetId] : undefined
  const worn = getWornArmor(state, root)
  const arrived = target && worn && !isArmorBare(target, damage) ? outcomeOf(facts, target)?.arrived : undefined
  if (!target || !worn || !arrived) return []
  const blow = { ...getBlow(damage), ...arrived }
  return [{ slot: 'armor', ownerId: target.id, itemId: worn.item.id, chance: getBreakChance(blow, { RES: worn.armor.RES, hardness: getHardness(worn.armor.material) }), swung: false, shield: false }]
}

// combat.tex "Attack against equipment": a hit or a critical lands the blow,
// at that degree, on the weakest part of the item the strike was aimed at.
function getEquipmentRisks(state: CombatState, root: StrikeAction, damage: Damage, degree: NonNullable<Delivery['degree']>): BreakRisk[] {
  const target = root.targetId ? state.characters[root.targetId] : undefined
  const item = target && getHeldItem(target, root.object)
  const part = item && getWeakestPart(item)
  if (!target || !part || (degree !== 'hit' && degree !== 'critical')) return []
  const blow = getBlow(damage)
  const landed = { ...blow, blunt: getUndefendedDamage(blow.blunt, degree), cut: getUndefendedDamage(blow.cut, degree) }
  return [{ slot: 'object', ownerId: target.id, itemId: root.object, chance: getBreakChance(landed, part), swung: false, shield: false }]
}

// An item the blow broke, named while it can still be found.
function broken(state: CombatState, ownerId: string, itemId: string): BrokenItem {
  return { ownerId, itemId, name: getItemName(state, ownerId, itemId) }
}

// The items the blow puts at risk as it lands, each with its chance.
export function getBreakRisks(state: CombatState, root: AttackAction, facts: Delivery | null): BreakRisk[] {
  if (!state.breakage || facts?.effect.type !== 'damage' || facts.degree === null) return []
  const damage = facts.effect.effect
  const struck = isObjectStrike(root) ? getEquipmentRisks(state, root, damage, facts.degree) : getArmorRisks(state, root, facts, damage)
  return [...getObjectRisks(state, root, getBlow(damage)), ...struck]
}

// The items the attack broke as it landed, from the percentiles thrown with
// its roll.
export function getBlowBreakage(state: CombatState, root: AttackAction, facts: Delivery | null): BrokenItem[] {
  return getBreakRisks(state, root, facts).filter((risk) => isBroken(risk, root.breakRolls[risk.slot])).map((risk) => broken(state, risk.ownerId, risk.itemId))
}
