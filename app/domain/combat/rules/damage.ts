import type { Character, Damage, DamageComponent, DamageKind, Delivery, Item, Weapon } from '../../types'
import type { AttackAction, CombatState, HOPPurchase, MoveAction, Trample } from '../types'
import { getBlowTrample } from './trample'
import { HOP_PURCHASES } from '../../lists'
import { HOP_EFFECTS } from '../../tables'
import { getArmor } from '../../character/rules/armor'
import { Outcome, getOutcome } from '../../character/rules/damage'
import { getBlockValue, getBracedBonus, getHookBonus } from '../../character/rules/gear'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { getDM } from '../../character/rules/helpers'
import { getBalance, getForce } from '../../character/rules/skills'
import { getHardness } from '../../item/rules/items'
import { hasProperty } from '../../weaponProperties'
import { getAction, getAttackVariant, getReactionsTo, getShotDefense } from './action'
import { findWeaponRow } from './weaponRow'
import { getMovementSpeed, getStepDelta, isHookedRunner } from './move'

// ---------------------------------------------------------------------------
// The attacker's side: what an attack delivers, as a damage effect with the
// degree its test came to. The target's side — what that does to whoever
// it lands on — is the character's own damage lens.

type Defense = Pick<Damage, 'defense' | 'defenseAP' | 'defenseWeaponKey' | 'block' | 'shield'>
const UNDEFENDED: Defense = { defense: 'none', defenseAP: 0, defenseWeaponKey: '', block: 0, shield: false }

// What the attack was met with, what it cost the one who met it, and what
// the object absorbs. A strike is met by its target alone; a shot by its
// target or by an adjacent guard, whose shield it is that absorbs.
function getDefense(state: CombatState, root: AttackAction): Defense {
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  const reaction = root.kind === 'shoot' ? getShotDefense(state, root) : defender ? getReactionsTo(state, root.id).find((r) => r.actorId === defender.id) : undefined
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
      shield: row?.weapon.shield !== undefined,
    }
  }
  if (reaction.kind === 'evade' || reaction.kind === 'evasiveJump' || reaction.kind === 'evasion') return { ...UNDEFENDED, defense: reaction.kind, defenseAP }
  return UNDEFENDED
}

// A damage effect on its way, at a degree already decided by the producer.
function delivering(name: string, damage: Damage, degree: Delivery['degree']): Delivery {
  return { effect: { name, trigger: 'instant', type: 'damage', effect: damage }, degree, test: null, when: null, then: [], locks: null }
}

function addTo(damage: Damage, kind: DamageKind, value: number): Damage {
  return { ...damage, damage: damage.damage.map((d) => (d.kind === kind ? { ...d, value: d.value + value } : d)) }
}

// combat.tex "Success Overflow", "Hand": what each purchase does to the
// damage on its way, bought `times` over. "Extra cut: Increases cutting
// damage by 1xDM per HOP"; "Smash: ... add 2 xDM extra damage and upgrades
// an interrupt to a stun"; the rest mark the damage for the target's side
// to read — the bypass against their armor, the cut against equal hardness,
// the switch to the hand.
type Buyer = { state: CombatState; root: AttackAction; attacker: Character; weapon: Weapon }

// A bonus that adds to the physical damage, blunt and cutting alike, as the
// heavy one does (combat.tex "Heavy Attack").
function addPhysical(damage: Damage, value: number): Damage {
  return addTo(addTo(damage, 'blunt', value), 'cut', value)
}

const HOP_TRANSFORMS: Record<HOPPurchase, (damage: Damage, times: number, buyer: Buyer) => Damage> = {
  slice: (d, times, { attacker }) => addTo(d, 'cut', times * Math.floor(1 * getDM(attacker))),
  smash: (d, times, { attacker }) => ({ ...addTo(d, 'blunt', times * Math.floor(2 * getDM(attacker))), smash: true }),
  bypass: (d) => ({ ...d, bypass: true }),
  bust: (d) => ({ ...d, bust: true }),
  handSwitch: (d) => ({ ...d, location: 'hand' }),
  // combat.tex "Assassinate": "It automatically applies bypass."
  assassinate: (d) => ({ ...d, bypass: true }),
  braced: (d, _, { attacker, weapon }) => addPhysical(d, getBracedBonus(weapon, attacker)),
  hook: (d, _, { state, root, attacker, weapon }) => addPhysical(d, getHookBonus(weapon, attacker, getHookedMotion(state, root))),
}

// ---------------------------------------------------------------------------
// Braced and hooked strikes

// The move an opportunity strike was drawn by and the step it fires on;
// null for a strike no move opened.
function getOpportunityStep(state: CombatState, root: AttackAction): { move: MoveAction; at: number; reactorId: string } | null {
  const reaction = root.spawnedBy ? getAction(state, root.spawnedBy) : null
  const move = reaction?.kind === 'opportunityAttack' && reaction.reactionTo ? getAction(state, reaction.reactionTo) : null
  return reaction?.kind === 'opportunityAttack' && reaction.at !== null && move?.kind === 'move' ? { move, at: reaction.at, reactorId: reaction.actorId } : null
}

// combat.tex "Braced Attack": "a reaction when a target is moving towards
// the weapon ... when movement is between two spaces within weapon range" —
// the opportunity attack a step towards the attacker draws.
function isBracedChance(state: CombatState, root: AttackAction): boolean {
  const step = getOpportunityStep(state, root)
  return step !== null && (getStepDelta(state, step.move, step.at, step.reactorId) ?? 0) < 0
}

// combat.tex "Hook Attack": "used as an action or as a reaction against
// running targets that move away from the weapon".
function isHookChance(state: CombatState, root: AttackAction): boolean {
  if (root.kind !== 'strike') return false
  if (!root.opportunity) return true
  const step = getOpportunityStep(state, root)
  return step !== null && isHookedRunner(state, step.move, step.at, step.reactorId)
}

// What the hooked target was doing: jumping clear of the blow, running, or
// neither.
function getHookedMotion(state: CombatState, root: AttackAction): 'running' | 'jumping' | null {
  if (root.targetId && getReactionsTo(state, root.id).some((r) => r.actorId === root.targetId && r.kind === 'evasiveJump')) return 'jumping'
  const step = getOpportunityStep(state, root)
  return step && step.move.actorId === root.targetId && step.move.movement === 'run' ? 'running' : null
}

// combat.tex "Braced Attack": "The additional damage effect also triggers a
// trample" — a braced hit, against the mover it met; combat.tex "Catch": so
// does a catch that lands.
export function getStrikeTrample(state: CombatState, root: AttackAction): Trample | null {
  if (root.kind !== 'strike' || (!root.catch && (root.spent.braced ?? 0) === 0) || root.roll?.degree !== 'hit') return null
  const step = getOpportunityStep(state, root)
  return step ? getBlowTrample(state, root, step.move, step.at) : null
}

// combat.tex "Trip": "a comparison between the attacker's force and target's
// balance + force. If anyone is jumping or running, the attacker gets a bonus
// equal to the moving party's movement speed. If the attacker's value is
// higher, the target falls and is prone. Targeting the head or legs increases
// the attacker's value by +5." The moving party is the target; an evasive
// jump moves at the backwards jump ("Evasive Jump").
export function isTripped(state: CombatState, root: AttackAction): boolean {
  const attacker = state.characters[root.actorId]
  const target = root.targetId ? state.characters[root.targetId] : undefined
  if (!attacker || !target || (root.spent.hook ?? 0) === 0 || root.roll?.degree !== 'hit') return false
  const motion = getHookedMotion(state, root)
  const speed = motion === 'running' ? getMovementSpeed(target, 'run') : motion === 'jumping' ? getMovementSpeed(target, 'jump') / 2 : 0
  const aimed = root.location === 'head' || root.location === 'leg' ? 5 : 0
  return getForce(attacker) + speed + aimed > getBalance(target) + getForce(target)
}

// The attack as the attacker delivers it, once the die is known and the HOP
// are spent: the variation's damage as the row and the variation make it,
// where it was aimed, what it met — then each purchase bought, applied in
// turn — and the degree the test came to.
export function getAttackFacts(state: CombatState, root: AttackAction): Delivery | null {
  const attacker = state.characters[root.actorId]
  if (!attacker || !root.roll) return null
  const variant = getAttackVariant(attacker, root)
  const row = findWeaponRow(attacker, root.weaponKey, root.attack)
  if (!variant || !row) return null
  const base: Damage = {
    damage: [{ kind: 'blunt', value: variant.blunt }, { kind: 'cut', value: variant.cut }, ...getChargeDamage(attacker, root)],
    hardness: getHardness(row.atk.material),
    force: getForce(attacker),
    properties: row.atk.properties,
    location: root.location,
    ...getDefense(state, root),
    bypass: false,
    bust: false,
    smash: false,
  }
  const buyer: Buyer = { state, root, attacker, weapon: row.weapon }
  const bought = HOP_PURCHASES.reduce((d, p) => ((root.spent[p] ?? 0) > 0 ? HOP_TRANSFORMS[p](d, root.spent[p]!, buyer) : d), base)
  return delivering(`${row.weapon.name} ${row.atk.name}`, bought, root.roll.degree)
}

// spells.tex "Charged", Taser: "discharges on the first object it comes into
// contact with, adding its damage to the attack" — the charge in the item
// the blow is made with rides on it, and each kind it carries is measured
// against its own armor value where it lands (combat.tex "Physical
// attacks"). The charge is scaled by whoever swings it: what it was made
// with is not written into the item.
export function getChargedWeapon(c: Character, action: AttackAction): Item | null {
  const row = findWeaponRow(c, action.weaponKey, action.attack)
  const item = row ? c.held.find((i) => i.id === row.wielded.itemId) : undefined
  return item?.charge ? item : null
}

function getChargeDamage(c: Character, action: AttackAction): DamageComponent[] {
  const charge = getChargedWeapon(c, action)?.charge
  if (!charge) return []
  return charge.effects.flatMap((e) => (e.type === 'damage' && e.area === null ? e.effect.damage : []))
}

// ---------------------------------------------------------------------------
// Spending HOP

export type HOPOption = {
  purchase: HOPPurchase
  label: string
  cost: number
  // what it takes from the attacker on top of the HOP, paid as the action
  // resolves
  price: ActionCost | null
  bought: number
  available: boolean
  reason: string | null
}

const HOP_LABELS: Record<HOPPurchase, string> = {
  slice: 'slice',
  bypass: 'bypass',
  bust: 'bust',
  smash: 'smash',
  handSwitch: 'switch to hand',
  assassinate: 'assassinate',
  braced: 'braced',
  hook: 'hook (trip)',
}

// combat.tex "Assassinate": "This costs 1 extra AP on the normal cost of the
// attack"; "Braced Attack": "an additional +2AP and +1STA on top of the
// normal attack cost"; "Hook Attack": "On a hit, the character can spend +1
// AP +1STA to attempt to trip their target".
export function getHOPPrice(purchase: HOPPurchase, attacker: Character): ActionCost | null {
  switch (purchase) {
    case 'assassinate': return getActionCost(attacker, 'assassinate')
    case 'braced': return getActionCost(attacker, 'braced')
    case 'hook': return getActionCost(attacker, 'hookTrip')
    default: return null
  }
}

function priceOf(purchase: HOPPurchase, target: Character): number {
  const { cost } = HOP_EFFECTS[purchase]
  return cost === 'deflection' ? getArmor(target).deflection : cost
}

export function getHOPSpent(root: AttackAction, target: Character): number {
  return HOP_PURCHASES.reduce((sum, p) => sum + (root.spent[p] ?? 0) * priceOf(p, target), 0)
}

export function getHOPRemaining(root: AttackAction, target: Character): number {
  return (root.roll?.HOP ?? 0) - getHOPSpent(root, target)
}

// combat.tex "Success Overflow": what the hit's overflow can still buy, each
// priced against the target and gated by the weapon (gear.tex "Weapons
// Properties") and by what the effect needs to mean anything.
export function getHOPOptions(state: CombatState, root: AttackAction): HOPOption[] {
  const attacker = state.characters[root.actorId]
  const target = root.targetId ? state.characters[root.targetId] : undefined
  const row = attacker ? findWeaponRow(attacker, root.weaponKey, root.attack) : null
  if (!attacker || !target || !row || !root.roll || root.roll.degree !== 'hit') return []
  const remaining = getHOPRemaining(root, target)
  const armor = getArmor(target)
  const { defense, shield } = getDefense(state, root)

  return HOP_PURCHASES.map((purchase) => {
    const { property } = HOP_EFFECTS[purchase]
    const cost = priceOf(purchase, target)
    const bought = root.spent[purchase] ?? 0
    const price = getHOPPrice(purchase, attacker)
    const closed = (reason: string): HOPOption => ({ purchase, label: HOP_LABELS[purchase], cost, price, bought, available: false, reason })
    if ((purchase === 'assassinate' || purchase === 'braced' || purchase === 'hook') && root.kind !== 'strike') return closed('strikes only')
    if (property && !hasProperty(row.atk.properties, property)) return closed(`needs ${property}`)
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
    // combat.tex "Armor Bypass": "can only be done against rigid armor".
    if ((purchase === 'bypass' || purchase === 'assassinate') && !armor.properties.includes('rigid')) return closed('armor is not rigid')
    // combat.tex "Penetrating": cutting "against objects with the same hardness".
    if (purchase === 'bust' && getHardness(row.atk.material) !== getHardness(armor.material)) return closed('hardness differs')
    // combat.tex "Hand": "when the target tries to block or intercept without a shield".
    if (purchase === 'handSwitch' && !((defense === 'block' || defense === 'intercept') && !shield)) return closed('no unshielded block')
    if (cost > remaining) return closed('not enough HOP')
    if (price && !canAfford(attacker, price)) return closed('cannot afford')
    return { purchase, label: HOP_LABELS[purchase], cost, price, bought, available: true, reason: null }
  })
}

// ---------------------------------------------------------------------------
// Previews

// What a delivery of damage would do to its target, or nothing for any
// other effect or one with no degree yet.
export function outcomeOf(delivery: Delivery, target: Character): Outcome | null {
  return delivery.effect.type === 'damage' && delivery.degree !== null ? getOutcome(delivery.effect.effect, delivery.degree, target) : null
}
