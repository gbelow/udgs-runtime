import type { Action, ActionOf, AttackAction, CombatState, Deliveries, StrikeAction } from '../types'
import type { Armor, Character, Damage, Delivery, Item } from '../../types'
import { breaksOn, getArmorBreakChance, getBlow, getBreakChance, getRowBreakTerms, type Breakable, type BreakingBlow } from '../../character/rules/breakage'
import { getItemArmor } from '../../item/rules/items'
import { getUndefendedDamage } from '../../character/rules/damage'
import { getDefendingReaction } from './attack'
import { outcomeOf } from './damage'
import { getHeldItem } from '../../item/rules/hands'
import { getObjectPart, isObjectStrike } from './equipment'
import { getFloorObject } from './floorStrike'
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

// The armor item a character wears, while it is whole, and what it is.
function getWornArmor(target: Character | undefined): { item: Item; armor: Armor } | null {
  const item = target?.worn
  const armor = item && !item.broken ? getItemArmor(item) : undefined
  return item && armor ? { item, armor } : null
}

// Whether the attack puts anything at risk, and so needs its percentiles: the
// object that meets it, or the armor worn.
export function needsBreakRolls(state: CombatState, root: AttackAction): boolean {
  return state.breakage && (isObjectStrike(root) || getBreakingDefense(state, root) !== null || getWornArmor(root.targetId ? state.characters[root.targetId] : undefined) !== null)
}

// An item a character holds that can give way: never a natural weapon, nor
// one already broken.
function getBreakable(row: WeaponRow | null): (Breakable & { itemId: string }) | null {
  if (!row || row.wielded.natural || row.wielded.broken) return null
  return { itemId: row.wielded.itemId, RES: row.atk.RES }
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

// The armor a character wears takes the damage that arrived past the degree
// and any defense, whatever dealt it — a blow, a shot, a spell, an explosion
// — as one blow for everything that reached them in the action.
export function getArmorRisk(target: Character, deliveries: Delivery[]): BreakRisk | null {
  const hits = deliveries.flatMap((d) => {
    const outcome = outcomeOf(d, target)
    return outcome && d.effect.type === 'damage' ? [{ damage: d.effect.effect, outcome }] : []
  })
  const chance = getArmorBreakChance(target, hits)
  return chance > 0 ? { slot: 'armor', ownerId: target.id, itemId: target.worn?.id ?? '', chance, swung: false, shield: false } : null
}

function getArmorRisks(state: CombatState, root: AttackAction, facts: Delivery): BreakRisk[] {
  const target = root.targetId ? state.characters[root.targetId] : undefined
  const risk = target && getArmorRisk(target, [facts])
  return risk ? [risk] : []
}

// combat.tex "Attack against equipment": a hit or a critical lands the blow,
// at that degree, on the weakest part of the item the strike was aimed at.
function getEquipmentRisks(state: CombatState, root: StrikeAction, damage: Damage, degree: NonNullable<Delivery['degree']>): BreakRisk[] {
  const target = root.targetId ? state.characters[root.targetId] : undefined
  const floor = getFloorObject(state, root)
  const item = floor ? floor.item : target && getHeldItem(target, root.object)
  const ownerId = floor ? floor.item.id : target?.id
  const part = item && getObjectPart(item)
  if (!ownerId || !part || (degree !== 'hit' && degree !== 'critical')) return []
  const blow = getBlow(damage)
  const landed = { ...blow, blunt: getUndefendedDamage(blow.blunt, degree), cut: getUndefendedDamage(blow.cut, degree) }
  return [{ slot: 'object', ownerId, itemId: root.object, chance: getBreakChance(landed, part), swung: false, shield: false }]
}

// The items the blow puts at risk as it lands, each with its chance.
export function getBreakRisks(state: CombatState, root: AttackAction, facts: Delivery | null): BreakRisk[] {
  if (!state.breakage || facts?.effect.type !== 'damage' || facts.degree === null) return []
  const damage = facts.effect.effect
  const struck = isObjectStrike(root) ? getEquipmentRisks(state, root, damage, facts.degree) : getArmorRisks(state, root, facts)
  return [...getObjectRisks(state, root, getBlow(damage)), ...struck]
}

// An item at risk as the break that carries it to its owner, with the
// percentile thrown for it, named while it can still be found.
function makeBreak(state: CombatState, { ownerId, itemId, chance }: BreakRisk, roll: number): { id: string; delivery: Delivery } {
  const effect = { name: getItemName(state, ownerId, itemId), trigger: 'instant' as const, type: 'break' as const, effect: { itemId, chance, roll } }
  return { id: ownerId, delivery: { effect, degree: null, test: null, when: null, then: [], locks: null } }
}

function byOwner(breaks: { id: string; delivery: Delivery }[]): Deliveries {
  const grouped: Deliveries = {}
  for (const { id, delivery } of breaks) grouped[id] = [...(grouped[id] ?? []), delivery]
  return grouped
}

// gear.tex "Equipment Breakage": every item a blow puts at risk becomes a
// break delivered to its owner, tested with the percentile thrown for its
// slot with the roll.
export function getAttackBreaks(state: CombatState, root: AttackAction, facts: Delivery | null): Deliveries {
  return byOwner(getBreakRisks(state, root, facts).filter((risk) => risk.chance > 0).map((risk) => makeBreak(state, risk, root.breakRolls[risk.slot])))
}

// The armor each character wears is put at risk by what the action's
// effects did to them, with the percentile thrown for that character.
export function getAreaBreaks(state: CombatState, facts: Deliveries, rolls: Record<string, number>): Deliveries {
  if (!state.breakage) return {}
  return byOwner(Object.entries(facts).flatMap(([id, deliveries]) => {
    const target = state.characters[id]
    const risk = target && getArmorRisk(target, deliveries)
    return risk && rolls[id] !== undefined ? [makeBreak(state, risk, rolls[id])] : []
  }))
}

// What the action's breaks reach, per owner.
export function getBreaks(action: Action): Deliveries {
  return 'breaks' in action ? action.breaks : {}
}

// The items the action broke, from the percentiles thrown with it.
export function getBrokenItems(action: Action): { ownerId: string; itemId: string; name: string }[] {
  return Object.entries(getBreaks(action)).flatMap(([ownerId, deliveries]) => deliveries.flatMap(({ effect }) =>
    effect.type === 'break' && breaksOn(effect.effect.chance, effect.effect.roll) ? [{ ownerId, itemId: effect.effect.itemId, name: effect.name }] : []))
}
