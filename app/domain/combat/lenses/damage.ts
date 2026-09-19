import type { AfflictionKey, Armor, Character } from '../../types'
import type { Action, CombatState, DefenseKind, HOPPurchase, StrikeAction, StrikeFacts } from '../types'
import { HOP_PURCHASES } from '../../lists'
import { HEAD, HOP_EFFECTS, INTERRUPTION_AP, LOCATIONS, MAX_TIER, SHOCKED, STUN_AP, WOUNDS, injuryMap } from '../../tables'
import { getArmor } from '../../character/lenses/armor'
import { getBlockValue } from '../../character/lenses/gear'
import { getDM } from '../../character/lenses/helpers'
import { getTGH } from '../../character/lenses/misc'
import { getForce } from '../../character/lenses/skills'
import { getHardness } from '../../item/lenses/items'
import { hasProperty } from '../../weaponProperties'
import { findWeaponRow, getReactionsTo, getStrikeVariant } from './action'

// ---------------------------------------------------------------------------
// The attacker's side

// What the defender met the strike with, and what that object absorbs.
function getDefense(state: CombatState, root: StrikeAction): { defense: DefenseKind; block: number; shield: boolean } {
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  const reaction = defender ? getReactionsTo(state, root.id).find((r) => r.actorId === defender.id) : undefined
  if (!defender || !reaction) return { defense: 'none', block: 0, shield: false }
  if (reaction.kind === 'block' || reaction.kind === 'intercept') {
    const row = findWeaponRow(defender, reaction.weaponKey, reaction.attack)
    return {
      defense: reaction.kind,
      block: row ? getBlockValue(row.atk, row.weapon, defender) ?? 0 : 0,
      shield: row?.weapon.shield !== undefined,
    }
  }
  if (reaction.kind === 'evade' || reaction.kind === 'evasiveJump') return { defense: reaction.kind, block: 0, shield: false }
  return { defense: 'none', block: 0, shield: false }
}

// The strike as the attacker delivers it, once the die is known and the HOP
// are spent: the variation's damage plus the extra cut bought (combat.tex
// "Extra cut": "+1 x DM per HOP"), the effects bought, where it lands (the
// hand switch moves it — combat.tex "Hand"), and what it met.
export function getStrikeFacts(state: CombatState, root: StrikeAction): StrikeFacts | null {
  const attacker = state.characters[root.actorId]
  if (!attacker || !root.roll) return null
  const variant = getStrikeVariant(attacker, root)
  const row = findWeaponRow(attacker, root.weaponKey, root.attack)
  if (!variant || !row) return null
  const bought = (p: HOPPurchase) => root.spent[p] ?? 0
  return {
    blunt: variant.blunt,
    cut: variant.cut + bought('extraCut') * Math.floor(1 * getDM(attacker)),
    hardness: getHardness(row.atk.material),
    force: getForce(attacker),
    properties: row.atk.properties,
    location: bought('handSwitch') > 0 ? 'hand' : root.location,
    degree: root.roll.degree,
    ...getDefense(state, root),
    bypass: bought('bypass') > 0,
    penetrating: bought('penetrating') > 0,
    smash: bought('smash') > 0,
  }
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

export function getHOPSpent(root: StrikeAction, target: Character): number {
  return HOP_PURCHASES.reduce((sum, p) => sum + (root.spent[p] ?? 0) * priceOf(p, target), 0)
}

export function getHOPRemaining(root: StrikeAction, target: Character): number {
  return (root.roll?.HOP ?? 0) - getHOPSpent(root, target)
}

// combat.tex "Success Overflow": what the hit's overflow can still buy, each
// priced against the target and gated by the weapon (gear.tex "Weapons
// Properties") and by what the effect needs to mean anything.
export function getHOPOptions(state: CombatState, root: StrikeAction): HOPOption[] {
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
// The target's side

export type DamageType = 'blunt' | 'cut'

export type Outcome = {
  // combat.tex "Intercept": the blow never lands
  stopped: boolean
  type: DamageType
  damage: number
  // the armor value the damage was measured against
  armor: number
  // null: below the armor, no injury
  tier: number | null
  // the tier the body takes after the location's cap
  bodyTier: number | null
  IL: number
  bleed: number
  wound: { name: string; heal: number | null } | null
  afflictions: AfflictionKey[]
  // combat.tex "Interruption", "Stun": the AP the target loses, and to which
  interruption: 'none' | 'interrupted' | 'stunned'
  apLoss: number
  dead: boolean
}

const NOTHING: Outcome = { stopped: false, type: 'blunt', damage: 0, armor: 0, tier: null, bodyTier: null, IL: 0, bleed: 0, wound: null, afflictions: [], interruption: 'none', apLoss: 0, dead: false }

// combat.tex "Strike", "Defend": what the degree and the defense leave of the
// damage. A hit is always full. Without an object in the way a graze is half
// and a miss nothing; a block takes its value off a graze and one and a half
// times that off a miss; an intercept stops the blow outright unless the
// attacker's Force outdoes the defender's by 5 on a graze or 8 on a miss.
function afterDefense(facts: StrikeFacts, target: Character, damage: number): { damage: number; stopped: boolean } {
  if (facts.degree === 'hit') return { damage, stopped: false }
  switch (facts.defense) {
    case 'block':
      return { damage: Math.max(0, damage - (facts.degree === 'graze' ? facts.block : Math.floor(1.5 * facts.block))), stopped: false }
    case 'intercept': {
      const margin = facts.degree === 'graze' ? 5 : 8
      return facts.force >= getForce(target) + margin ? { damage, stopped: false } : { damage: 0, stopped: true }
    }
    default:
      return { damage: facts.degree === 'graze' ? Math.floor(damage / 2) : 0, stopped: false }
  }
}

// combat.tex "Hand": "Hands have no armor unless the character is wearing
// gauntlets"; "Head": "Armor bypass at the head hits flesh, which ignores all
// armor". Bare flesh is the armor schema's own default.
function armorAt(target: Character, facts: StrikeFacts): Armor {
  const armor = getArmor(target)
  if (facts.location === 'hand' && !target.hasGauntlets) return { ...armor, name: 'flesh', material: 'flesh', RES: 0, protection: 0, properties: [] }
  if (facts.location === 'head' && facts.bypass) return { ...armor, name: 'flesh', material: 'flesh', RES: 0, protection: 0, properties: [] }
  return armor
}

// combat.tex "Damage Tiers": tier N is met at armor + N x TGH; below the
// armor there is no injury, and neither is there from a blow that carries no
// damage at all — a miss, a grapple — however bare the target.
function tierOf(damage: number, armor: number, TGH: number): number | null {
  if (damage <= 0 || damage < armor) return null
  if (TGH <= 0) return MAX_TIER
  return Math.min(MAX_TIER, Math.floor((damage - armor) / TGH))
}

// combat.tex "Physical attacks": "If the weapon is not capable of cutting its
// target, the damage is blunt, otherwise, use the most advantageous of the
// two." "What cuts?": harder than the target; combat.tex "Penetrating" buys
// the same hardness. "Armor Bypass" adds half the armor value to the damage.
export function getOutcome(facts: StrikeFacts, target: Character): Outcome {
  const armor = armorAt(target, facts)
  const TGH = getTGH(target)
  const armorHardness = getHardness(armor.material)
  const canCut = facts.hardness > armorHardness || (facts.penetrating && facts.hardness === armorHardness)

  const bypass = (value: number) => (facts.bypass ? Math.floor(value / 2) : 0)
  const blunt = afterDefense(facts, target, facts.blunt + bypass(armor.protection))
  const cut = afterDefense(facts, target, facts.cut + bypass(armor.RES))
  if (blunt.stopped) return { ...NOTHING, stopped: true }

  const asBlunt = { type: 'blunt' as const, damage: blunt.damage, armor: armor.protection, tier: tierOf(blunt.damage, armor.protection, TGH) }
  const asCut = { type: 'cut' as const, damage: cut.damage, armor: armor.RES, tier: tierOf(cut.damage, armor.RES, TGH) }
  const best = canCut && (asCut.tier ?? -1) > (asBlunt.tier ?? -1) ? asCut : asBlunt
  if (best.tier === null) return { ...NOTHING, ...best }

  const cap = LOCATIONS[facts.location].maxTier
  const bodyTier = cap === null ? best.tier : Math.min(best.tier, cap)
  const row = injuryMap[`T${bodyTier}`]
  // gear.tex "Piercing": "half the amount of IL damage per tier to body and
  // limb and cannot amputate"
  const piercing = hasProperty(facts.properties, 'piercing')

  return {
    ...best,
    stopped: false,
    bodyTier,
    IL: piercing ? Math.floor(row.IL / 2) : row.IL,
    bleed: row.bleed,
    ...effectsOf(facts, best.type, best.tier, piercing),
  }
}

// combat.tex "Additional effects", "Localized damage", "Wounds": what the
// tier does beyond IL. Interruption on T1+ blunt; stun when smash was bought
// and the damage is T1+; the location's wound at its tier, the worst one the
// tier reaches; the head knocks out at T3 or on any stun and kills at T4;
// Shocked is a T4 blunt chest hit with smash.
function effectsOf(facts: StrikeFacts, type: DamageType, tier: number, piercing: boolean): Pick<Outcome, 'wound' | 'afflictions' | 'interruption' | 'apLoss' | 'dead'> {
  const stunned = facts.smash && tier >= 1
  const interrupted = type === 'blunt' && tier >= 1
  const afflictions = new Set<AfflictionKey>()
  let wound: Outcome['wound'] = null
  let dead = false

  const reached = WOUNDS[facts.location].filter((w) => tier >= w.tier && !(piercing && w.amputation))
  const worst = reached[reached.length - 1]
  if (worst) {
    wound = { name: worst.name, heal: worst.heal }
    if (worst.affliction) afflictions.add(worst.affliction)
  }
  if (facts.location === 'chest' && type === 'blunt' && facts.smash && tier >= SHOCKED.tier) {
    wound = { name: SHOCKED.name, heal: SHOCKED.heal }
    afflictions.add(SHOCKED.affliction)
  }
  if (facts.location === 'head') {
    if (tier >= HEAD.unconscious || stunned) afflictions.add('unconscious')
    if (tier >= HEAD.death) dead = true
  }

  return {
    wound,
    afflictions: [...afflictions],
    interruption: stunned ? 'stunned' : interrupted ? 'interrupted' : 'none',
    apLoss: stunned ? STUN_AP : interrupted ? INTERRUPTION_AP : 0,
    dead,
  }
}

// The outcome of the open strike as it would land now: the same function the
// resolution applies, so the preview and the result cannot differ.
export function getOutcomePreview(state: CombatState, root: Action): Outcome | null {
  if (root.kind !== 'strike' || !root.targetId) return null
  const target = state.characters[root.targetId]
  const facts = root.facts ?? getStrikeFacts(state, root)
  return target && facts ? getOutcome(facts, target) : null
}
