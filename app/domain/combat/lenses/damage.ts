import type { Character, Damage, Delivery } from '../../types'
import type { Action, AttackAction, CombatState, ExplosionAction, ExplosionFacts, HOPPurchase } from '../types'
import { HOP_PURCHASES } from '../../lists'
import { HOP_EFFECTS } from '../../tables'
import { getArmor } from '../../character/lenses/armor'
import { Outcome, getOutcome } from '../../character/lenses/damage'
import { getBlockValue } from '../../character/lenses/gear'
import { getDM } from '../../character/lenses/helpers'
import { getForce } from '../../character/lenses/skills'
import { getHardness } from '../../item/lenses/items'
import { hasProperty } from '../../weaponProperties'
import { findWeaponRow, getAttackVariant, getReactionsTo, getShotDefense } from './action'
import { getAffected } from './explosion'

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
  return { effect: { name, trigger: 'instant', type: 'damage', effect: damage }, degree, when: null, then: [] }
}

// The attack as the attacker delivers it, once the die is known and the HOP
// are spent: the variation's damage plus the extra cut bought (combat.tex
// "Extra cut": "+1 x DM per HOP"), the effects bought, where it lands (the
// hand switch moves it — combat.tex "Hand"), what it met, and the degree
// the test came to.
export function getAttackFacts(state: CombatState, root: AttackAction): Delivery | null {
  const attacker = state.characters[root.actorId]
  if (!attacker || !root.roll) return null
  const variant = getAttackVariant(attacker, root)
  const row = findWeaponRow(attacker, root.weaponKey, root.attack)
  if (!variant || !row) return null
  const bought = (p: HOPPurchase) => root.spent[p] ?? 0
  return delivering(`${row.weapon.name} ${row.atk.name}`, {
    damage: [
      { kind: 'blunt', value: variant.blunt + bought('smash') * Math.floor(2 * getDM(attacker)) },
      { kind: 'cut', value: variant.cut + bought('extraCut') * Math.floor(1 * getDM(attacker)) },
    ],
    hardness: getHardness(row.atk.material),
    force: getForce(attacker),
    properties: row.atk.properties,
    location: bought('handSwitch') > 0 ? 'hand' : root.location,
    ...getDefense(state, root),
    bypass: bought('bypass') > 0,
    penetrating: bought('penetrating') > 0,
    smash: bought('smash') > 0,
  }, root.roll.degree)
}

// combat.tex "Explosions"; gear.tex "Explosion": "Being caught in the
// explosion applies the weapon's damage" — the row's damage as it reaches
// each character in the area, at the degree of the zone they stand in when
// it goes off, met by nothing but the reflex test they may have made. (The
// book's +5/−5 on the DL of an explosion's effects, and the grapple a net
// applies, have no effect modelled yet.)
export function getExplosionFacts(state: CombatState, root: ExplosionAction): ExplosionFacts | null {
  const attacker = state.characters[root.actorId]
  if (!attacker) return null
  const variant = getAttackVariant(attacker, root)
  const row = findWeaponRow(attacker, root.weaponKey, root.attack)
  if (!variant || !row) return null
  return Object.fromEntries(getAffected(state, root).map(({ id, degree }) => {
    const reaction = getReactionsTo(state, root.id).find((r) => r.actorId === id)
    return [id, delivering(`${row.weapon.name} ${row.atk.name}`, {
      damage: [{ kind: 'blunt', value: variant.blunt }, { kind: 'cut', value: variant.cut }],
      hardness: getHardness(row.atk.material),
      force: getForce(attacker),
      properties: row.atk.properties,
      location: 'chest',
      ...(reaction ? { ...UNDEFENDED, defense: 'avoidExplosion' as const, defenseAP: reaction.cost?.AP ?? 0 } : UNDEFENDED),
      bypass: false,
      penetrating: false,
      smash: false,
    }, degree)]
  }))
}

// ---------------------------------------------------------------------------
// Spending HOP

export type HOPOption = {
  purchase: HOPPurchase
  label: string
  cost: number
  bought: number
  available: boolean
  reason: string | null
}

const HOP_LABELS: Record<HOPPurchase, string> = {
  extraCut: 'extra cut',
  bypass: 'armor bypass',
  penetrating: 'penetrating',
  smash: 'smash',
  handSwitch: 'switch to hand',
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
    const closed = (reason: string): HOPOption => ({ purchase, label: HOP_LABELS[purchase], cost, bought, available: false, reason })
    if (property && !hasProperty(row.atk.properties, property)) return closed(`needs ${property}`)
    if (purchase !== 'extraCut' && bought > 0) return closed('bought')
    // combat.tex "Armor Bypass": "can only be done against rigid armor".
    if (purchase === 'bypass' && !armor.properties.includes('rigid')) return closed('armor is not rigid')
    // combat.tex "Penetrating": cutting "against objects with the same hardness".
    if (purchase === 'penetrating' && getHardness(row.atk.material) !== getHardness(armor.material)) return closed('hardness differs')
    // combat.tex "Hand": "when the target tries to block or intercept without a shield".
    if (purchase === 'handSwitch' && !((defense === 'block' || defense === 'intercept') && !shield)) return closed('no unshielded block')
    if (cost > remaining) return closed('not enough HOP')
    return { purchase, label: HOP_LABELS[purchase], cost, bought, available: true, reason: null }
  })
}

// ---------------------------------------------------------------------------
// Previews

// What a delivery of damage would do to its target, or nothing for any
// other effect or one with no degree yet.
export function outcomeOf(delivery: Delivery, target: Character): Outcome | null {
  return delivery.effect.type === 'damage' && delivery.degree !== null ? getOutcome(delivery.effect.effect, delivery.degree, target) : null
}

// The outcome of the open action on everyone it lands on, as it would land
// now: the same function the resolution applies, so the preview and the
// result cannot differ. One entry for the target of a strike or a shot; one
// per character in an explosion's area.
export function getOutcomePreviews(state: CombatState, root: Action): { id: string; outcome: Outcome }[] {
  if (root.kind === 'explosion') {
    const facts = root.facts ?? getExplosionFacts(state, root)
    return Object.entries(facts ?? {}).flatMap(([id, f]) => {
      const target = state.characters[id]
      const outcome = target ? outcomeOf(f, target) : null
      return outcome ? [{ id, outcome }] : []
    })
  }
  if ((root.kind !== 'strike' && root.kind !== 'shoot') || !root.targetId) return []
  const target = state.characters[root.targetId]
  const facts = root.facts ?? getAttackFacts(state, root)
  const outcome = target && facts ? outcomeOf(facts, target) : null
  return outcome ? [{ id: root.targetId, outcome }] : []
}
