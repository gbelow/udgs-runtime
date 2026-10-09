import type { Character, Damage, DamageComponent, DamageKind, Delivery, Item, Weapon, WeaponProperty, Edge } from '../../types'
import type { AttackAction, SceneState, HOPPurchase, Interruption, MoveAction, StrikeAction, Trample } from '../types'
import { getBlowTrample } from './trample'
import { HOP_PURCHASES } from '../../lists'
import { HOP_EFFECTS } from '../../tables'
import { getArmor, isVisorClosed } from '../../character/rules/armor'
import { getAimedPlace } from '../../character/rules/body'
import { Outcome, getOutcome } from '../../character/rules/damage'
import { getBlockValue, getBracedBonus, getHookBonus, getSliceBonus } from '../../character/rules/gear'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { getDM } from '../../character/rules/size'
import { getHardness } from '../../item/rules/items'
import { getHeldItem } from '../../item/rules/hands'
import { hasChargeTrigger } from '../../character/rules/spells'
import { produceSpellEffect } from '../../character/rules/production'
import { hasProperty } from '../../weaponProperties'
import { getOpeningReaction, getReactionsTo } from './log'
import { getAttackVariant, getDefendingReaction, getMoveStep, isBracedStep, isHookStep } from './attack'
import { findWeaponRow, getRowProperties, type WeaponRow } from './weaponRow'
import { UNDEFENDED, delivering, getRowDamage, type Defense } from './delivery'
import { getCover, getPlacedFootprint, toDamageWall } from './board/board'
import { canGrab, getGrabFacts } from './grapple'
import { isSweepLink } from './sweep'

// ---------------------------------------------------------------------------
// The attacker's side: what an attack delivers, as a damage effect with the
// degree its test came to. The target's side — what that does to whoever
// it lands on — is the character's own damage rule.

// What the attack was met with, what it cost the one who met it, and what
// the object absorbs. A strike is met by its target alone; a shot by its
// target or by an adjacent guard, whose shield it is that absorbs.
function getDefense(state: SceneState, root: AttackAction): Defense {
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  const reaction = getDefendingReaction(state, root)
  const reactor = reaction ? state.characters[reaction.actorId] : undefined
  if (!defender || !reaction || !reactor) return UNDEFENDED
  const defenseAP = reaction.cost?.AP ?? 0
  if (reaction.kind === 'block' || reaction.kind === 'intercept' || reaction.kind === 'guard') {
    const row = findWeaponRow(reactor, reaction.weaponKey, reaction.attack)
    return {
      defense: reaction.kind,
      defenseAP,
      defenseWeaponKey: reaction.weaponKey,
      block: row ? getBlockValue(row.atk, row.weapon, reactor) ?? 0 : 0,
      // combat.tex "Damage absorption": "The absorption value is RES of the target if that is an object"
      blockCap: row ? row.atk.RES : null,
      shield: row?.weapon.shield !== undefined,
    }
  }
  if (reaction.kind === 'evade' || reaction.kind === 'evasiveJump' || reaction.kind === 'evasion') return { ...UNDEFENDED, defense: reaction.kind, defenseAP }
  return UNDEFENDED
}

function addTo(damage: Damage, kind: DamageKind, value: number): Damage {
  return { ...damage, damage: damage.damage.map((d) => (d.kind === kind ? { ...d, value: d.value + value } : d)) }
}

// combat.tex "Success Overflow", "Hand": what each purchase does to the
// damage on its way, bought `times` over. "Slice: Increases cutting damage by
// 1xDM per HOP", 2xDM for a bladed and piercing weapon, 1.5xDM when sharp
// (gear.tex "Gear condition"); "Smash: ... add 2 xDM extra damage and upgrades
// an interrupt to a stun"; the rest mark the damage for the target's side
// to read — the bypass against their armor, the cut against equal hardness,
// the switch to the hand.
type Buyer = { state: SceneState; root: AttackAction; attacker: Character; weapon: Weapon; properties: WeaponProperty[]; edge: Edge | null }

// A bonus that adds to the physical damage, blunt and cutting alike, as the
// heavy one does (combat.tex "Heavy Attack").
function addPhysical(damage: Damage, value: number): Damage {
  return addTo(addTo(damage, 'blunt', value), 'cut', value)
}

const HOP_TRANSFORMS: Record<HOPPurchase, (damage: Damage, times: number, buyer: Buyer) => Damage> = {
  slice: (d, times, { attacker, properties, edge }) => addTo(d, 'cut', times * getSliceBonus(properties, edge, attacker)),
  smash: (d, times, { attacker }) => ({ ...addTo(d, 'blunt', times * Math.floor(2 * getDM(attacker))), smash: true }),
  bypass: (d) => ({ ...d, bypass: true }),
  bust: (d) => ({ ...d, bust: true }),
  handSwitch: (d) => ({ ...d, location: 'hand', part: null }),
  // combat.tex "Assassinate": "It automatically applies bypass."
  assassinate: (d) => ({ ...d, bypass: true }),
  braced: (d, _, { attacker, weapon }) => addPhysical(d, getBracedBonus(weapon, attacker)),
  hook: (d, _, { state, root, attacker, weapon }) => addPhysical(d, getHookBonus(weapon, attacker, getHookedMotion(state, root))),
}

// ---------------------------------------------------------------------------
// Braced and hooked strikes

// The move an opportunity strike was drawn by and the step it fires on;
// null for a strike no move opened.
function getOpportunityStep(state: SceneState, root: AttackAction): { move: MoveAction; at: number } | null {
  const reaction = getOpeningReaction(state, root)
  return reaction ? getMoveStep(state, reaction) : null
}

// combat.tex "Braced Attack": the opportunity attack a step towards the
// attacker draws.
function isBracedChance(state: SceneState, root: AttackAction): boolean {
  const reaction = getOpeningReaction(state, root)
  return reaction !== null && isBracedStep(state, reaction)
}

// combat.tex "Hook Attack": "used as an action or as a reaction against
// running targets that move away from the weapon".
function isHookChance(state: SceneState, root: AttackAction): boolean {
  if (root.kind !== 'strike') return false
  if (!root.opportunity) return true
  const reaction = getOpeningReaction(state, root)
  return reaction !== null && isHookStep(state, reaction)
}

// What the hooked target was doing: jumping clear of the blow, running, or
// neither.
export function getHookedMotion(state: SceneState, root: AttackAction): 'running' | 'jumping' | null {
  if (root.targetId && getReactionsTo(state, root.id).some((r) => r.actorId === root.targetId && r.kind === 'evasiveJump')) return 'jumping'
  const step = getOpportunityStep(state, root)
  return step && step.move.actorId === root.targetId && step.move.movement === 'run' ? 'running' : null
}

// combat.tex "Braced Attack": "On a hit, spend an additional +2AP and +1STA
// ... and trigger a trample" — against the mover it met; combat.tex
// "Evades": against a directed strike "a hit in the strike causes a crash",
// so does a catch that lands.
function getStrikeTrample(state: SceneState, root: AttackAction): Trample | null {
  if (root.kind !== 'strike' || (!root.catch && (root.spent.braced ?? 0) === 0) || root.roll?.degree !== 'hit') return null
  const step = getOpportunityStep(state, root)
  return step ? getBlowTrample(state, root, step.move, step.at) : null
}

// The attack as the attacker delivers it, once the die is known and the HOP
// are spent: the variation's damage as the row and the variation make it —
// what is left of it, for a sweep past its first target (combat.tex "Damage
// absorption"), which the charge already went off on — where it was aimed,
// what it met — then each purchase bought, applied in turn — and the degree
// the test came to.
export function getAttackFacts(state: SceneState, root: AttackAction): Delivery | null {
  const attacker = state.characters[root.actorId]
  if (!attacker || !root.roll) return null
  const variant = getAttackVariant(attacker, root)
  const row = findWeaponRow(attacker, root.weaponKey, root.attack)
  if (!variant || !row) return null
  const link = root.kind === 'strike' && isSweepLink(root)
  const share = root.kind === 'strike' ? root.share : 1
  const physical: DamageComponent[] = [{ kind: 'blunt', value: Math.floor(variant.blunt * share) }, { kind: 'cut', value: Math.floor(variant.cut * share) }]
  const charge = link ? [] : (getRowCharge(attacker, row)?.charge?.effects ?? []).filter((e) => e.area === null)
  const chargeDamage = charge.flatMap((e) => (e.type === 'damage' ? e.effect.damage : []))
  const base = { ...getRowDamage(attacker, row, [...physical, ...chargeDamage], { location: root.location, part: root.part }, getDefense(state, root)), wall: getShotWall(state, root) }
  const properties = getRowProperties(attacker, row, root.kind === 'shoot' ? root.ammoId : '')
  const buyer: Buyer = { state, root, attacker, weapon: row.weapon, properties, edge: row.wielded.edge }
  const bought = HOP_PURCHASES.reduce((d, p) => ((root.spent[p] ?? 0) > 0 ? HOP_TRANSFORMS[p](d, root.spent[p]!, buyer) : d), base)
  const followUps = charge.filter((e) => e.type !== 'damage').map((e) => produceSpellEffect(attacker, e))
  return { ...delivering(`${row.weapon.name} ${row.atk.name}`, bought, root.roll.degree), then: followUps }
}

// combat.tex "Cover": a wall that breaks between a shot's shooter and its
// target as they stand, which absorbs the shot. Nothing for a strike.
function getShotWall(state: SceneState, root: AttackAction): Damage['wall'] {
  const from = getPlacedFootprint(state, root.actorId)
  return root.kind === 'shoot' && root.targetId && from ? toDamageWall(getCover(state, from, root.targetId)) : null
}

// spells.tex "Charged", Taser: "discharges on the first object it comes into
// contact with, adding its damage to the attack" — a charge that goes off
// on contact, in the item the blow is made with, through a row of metal
// (the table's ruling). Its damage rides on the blow, each kind measured
// against its own armor value where it lands (combat.tex "Physical
// attacks"), and the rest of what it carries lands with it. The charge is
// as its caster made it: whoever swings it does not scale it again.
export function getChargedWeapon(c: Character, action: AttackAction): Item | null {
  const row = findWeaponRow(c, action.weaponKey, action.attack)
  return row ? getRowCharge(c, row) : null
}

function getRowCharge(c: Character, row: WeaponRow): Item | null {
  const item = getHeldItem(c, row.wielded.itemId)
  return item?.charge && row.atk.material === 'metal' && hasChargeTrigger(item.charge, 'contact') ? item : null
}

// What the attack's delivery does to its target's own action.
export function getInterruption(state: SceneState, root: AttackAction, facts: Delivery | null): Interruption {
  const target = root.targetId ? state.characters[root.targetId] : undefined
  return facts && target ? getDeliveryInterruption(facts, target) : 'none'
}

// What a delivery does to the own action of the one it lands on.
export function getDeliveryInterruption(delivery: Delivery, target: Character): Interruption {
  return outcomeOf(delivery, target)?.interruption ?? 'none'
}

// What a strike's landing did beyond its damage, written at the resolve:
// what it did to the target's own action, the trip and the trample it set
// off, the grab it made, and where the target's evasive jump took them.
// combat.tex "Initiate the Grab": "On a hit, the opponent is grappled, and
// any movement initiated by them is stopped"; combat.tex "Catch": "If the
// target is not stopped, only a strike with 5 HOPs or more succeeds in the
// grapple".
const CATCH_HOP = 5

// Whether the hit may grapple its target: made with a grapple row nothing has
// seized yet, at someone the attacker does not hold, and for a catch only
// where the mover was stopped or the strike had HOP enough.
export function canGrapple(state: SceneState, strike: StrikeAction): boolean {
  if (strike.roll?.degree !== 'hit' || !strike.targetId || !canGrab(state, strike, strike.targetId)) return false
  return !strike.catch || getStrikeTrample(state, strike)?.result === 'blocked' || (strike.roll.HOP ?? 0) >= CATCH_HOP
}

export function getStrikeLanding(state: SceneState, strike: StrikeAction, facts: Delivery | null): Pick<StrikeAction, 'interruption' | 'trample' | 'grabbed' | 'jumpedTo'> {
  const interruption = getInterruption(state, strike, facts)
  const trample = getStrikeTrample(state, strike)
  const grabbed = strike.grapples && canGrapple(state, strike) ? getGrabFacts(state, strike) : null
  const jump = getReactionsTo(state, strike.id).find((r) => r.kind === 'evasiveJump' && r.actorId === strike.targetId)
  return {
    interruption: grabbed && interruption === 'none' ? 'interrupted' : interruption,
    trample,
    grabbed,
    jumpedTo: jump?.kind === 'evasiveJump' ? jump.to : null,
  }
}

// ---------------------------------------------------------------------------
// Spending HOP

export type HOPOption = {
  purchase: HOPPurchase
  cost: number
  // what it takes from the attacker on top of the HOP, paid as the action
  // resolves
  price: ActionCost | null
  bought: number
  available: boolean
  reason: string | null
}

// combat.tex "Assassinate": "This costs 1 extra AP on the normal cost of the
// attack"; "Braced Attack": "an additional +2AP and +1STA on top of the
// normal attack cost"; "Hook Attack": "On a hit, the character can spend +2
// AP +1STA to get" its damage.
export function getHOPPrice(purchase: HOPPurchase, attacker: Character): ActionCost | null {
  switch (purchase) {
    case 'assassinate': return getActionCost(attacker, 'assassinate')
    case 'braced': return getActionCost(attacker, 'braced')
    case 'hook': return getActionCost(attacker, 'hook')
    default: return null
  }
}

function priceOf(purchase: HOPPurchase, target: Character): number {
  const { cost } = HOP_EFFECTS[purchase]
  return cost === 'deflection' ? getArmor(target).deflection : cost
}

function getHOPSpent(root: AttackAction, target: Character): number {
  return HOP_PURCHASES.reduce((sum, p) => sum + (root.spent[p] ?? 0) * priceOf(p, target), 0)
}

export function getHOPRemaining(root: AttackAction, target: Character): number {
  return (root.roll?.HOP ?? 0) - getHOPSpent(root, target)
}

// combat.tex "Success Overflow": what the hit's overflow can still buy, each
// priced against the target and gated by the weapon (gear.tex "Weapons
// Properties") and by what the effect needs to mean anything.
export function getHOPOptions(state: SceneState, root: AttackAction): HOPOption[] {
  const attacker = state.characters[root.actorId]
  const target = root.targetId ? state.characters[root.targetId] : undefined
  const row = attacker ? findWeaponRow(attacker, root.weaponKey, root.attack) : null
  if (!attacker || !target || !row || !root.roll || root.roll.degree !== 'hit') return []
  const remaining = getHOPRemaining(root, target)
  const properties = getRowProperties(attacker, row, root.kind === 'shoot' ? root.ammoId : '')
  const armor = getArmor(target)
  const { defense, shield } = getDefense(state, root)
  const aimed = getAimedPlace(target, root)

  return HOP_PURCHASES.map((purchase) => {
    const { property } = HOP_EFFECTS[purchase]
    const cost = priceOf(purchase, target)
    const bought = root.spent[purchase] ?? 0
    const price = getHOPPrice(purchase, attacker)
    const closed = (reason: string): HOPOption => ({ purchase, cost, price, bought, available: false, reason })
    if ((purchase === 'assassinate' || purchase === 'braced' || purchase === 'hook') && root.kind !== 'strike') return closed('strikes only')
    if (property && !hasProperty(properties, property)) return closed(`needs ${property}`)
    // gear.tex "Gear condition": "Dull - Bladed weapon cannot use Slice."
    if (purchase === 'slice' && row.wielded.edge === 'dull') return closed('dull')
    if (purchase !== 'slice' && bought > 0) return closed('bought')
    // combat.tex "Assassinate": "requires a short range ... weapon attack",
    // "Can only be done against SD, not against active defense".
    if (purchase === 'assassinate' && row.atk.range !== 'short') return closed('needs short range')
    if (purchase === 'assassinate' && defense !== 'none') return closed('target defended')
    // A braced or hook attack is declared as one (at the normal price) and
    // bought after the hit; combat.tex "Strike": "braced and hook attack
    // cannot be combined with anything", so no assassination under them.
    if ((purchase === 'braced' || purchase === 'hook') && root.variant !== purchase) return closed(`declare a ${purchase} attack`)
    if (purchase === 'assassinate' && (root.variant === 'braced' || root.variant === 'hook')) return closed(`${root.variant} attack`)
    if (purchase === 'braced' && !isBracedChance(state, root)) return closed('target not moving towards the weapon')
    if (purchase === 'hook' && !isHookChance(state, root)) return closed('not an action or a runner moving away')
    if ((purchase === 'bypass' && (root.spent.assassinate ?? 0) > 0) || (purchase === 'assassinate' && (root.spent.bypass ?? 0) > 0)) return closed('already bypassing')
    // gear.tex "Closed helmet": "armor bypass is impossible in the head",
    // while the visor is down — the part a bypass would reach flesh at
    if ((purchase === 'bypass' || purchase === 'assassinate') && aimed.flags.includes('bypassToFlesh') && isVisorClosed(target)) return closed('closed helmet')
    // combat.tex "Armor Bypass": "can only be done against rigid armor".
    if ((purchase === 'bypass' || purchase === 'assassinate') && !armor.properties.includes('rigid')) return closed('armor is not rigid')
    // combat.tex "Penetrating": cutting "against objects with the same hardness".
    if (purchase === 'bust' && getHardness(row.atk.material) !== getHardness(armor.material)) return closed('hardness differs')
    // combat.tex "Hand": "when the target tries to block or intercept without a shield".
    if (purchase === 'handSwitch' && !((defense === 'block' || defense === 'intercept') && !shield)) return closed('no unshielded block')
    if (cost > remaining) return closed('not enough HOP')
    if (price && !canAfford(attacker, price)) return closed('cannot afford')
    return { purchase, cost, price, bought, available: true, reason: null }
  })
}

// ---------------------------------------------------------------------------
// Previews

// What a delivery of damage would do to its target, or nothing for any
// other effect or one with no degree yet.
export function outcomeOf(delivery: Delivery, target: Character): Outcome | null {
  return delivery.effect.type === 'damage' && delivery.degree !== null ? getOutcome(delivery.effect.effect, delivery.degree, target) : null
}
