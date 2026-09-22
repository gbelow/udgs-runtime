import type { AfflictionKey, Armor, Character, Damage, DamageKind, Degree, Interruption } from '../../types'
import { HEAD, LOCATIONS, MAX_TIER, STUN_AP, STUN_TIER, WOUNDS, WoundKey, injuryMap } from '../../tables'
import { getArmor } from './armor'
import { getTGH } from './misc'
import { getForce } from './skills'
import { getHardness } from '../../item/rules/items'
import { getWieldedWeapons } from '../../item/rules/hands'
import { hasProperty } from '../../weaponProperties'

// What damage does to this character: the one place the injury rules are
// read. It takes the damage as delivered and the degree it lands at, and
// answers with nothing but the character's own armor and toughness — the
// producer has already said everything else.

export type Outcome = {
  // combat.tex "Intercept": the blow never lands
  stopped: boolean
  type: DamageKind
  damage: number
  // the armor value the damage was measured against
  armor: number
  // null: below the armor, no injury
  tier: number | null
  // each kind measured against its own armor value, before the choice; the
  // blunt one drives the blunt effects whichever kind is applied
  tiers: Partial<Record<DamageKind, number | null>>
  // the tier the body takes after the location's cap
  bodyTier: number | null
  IL: number
  bleed: number
  // combat.tex "Wounds": the wound the tier causes, and the hand it takes
  wound: { key: WoundKey; name: string; heal: number | null; hand: number | null } | null
  afflictions: AfflictionKey[]
  // combat.tex "Interruption", "Stun": what cuts the target's action short,
  // and the AP a stun takes on top
  interruption: Interruption
  apLoss: number
  dead: boolean
}

const NOTHING: Outcome = { stopped: false, type: 'blunt', damage: 0, armor: 0, tier: null, tiers: {}, bodyTier: null, IL: 0, bleed: 0, wound: null, afflictions: [], interruption: 'none', apLoss: 0, dead: false }

// combat.tex "Types of damage": the armor value each kind is defended by —
// "Blunt damage: is defended by armor protection", "Cutting damage: is
// defended by armor RES", burn, radiant, corrosive and electric by INS.
function armorValue(armor: Armor, kind: DamageKind): number {
  switch (kind) {
    case 'blunt': return armor.protection
    case 'cut': return armor.RES
    default: return armor.INS
  }
}

// combat.tex "Strike", "Defend": what the degree and the defense leave of the
// damage. A hit is always full. Without an object in the way a graze is half
// and a miss nothing; a block takes its value off a graze and one and a half
// times that off a miss; an intercept stops the blow outright unless the
// attacker's Force outdoes the defender's by 5 on a graze or 8 on a miss.
// combat.tex "Accuracy", "Reflex": a shot the same — "Grazes deal 50%
// damage and misses do nothing"; a guard is a block ("On graze, the attack
// damage is reduced by the block value. On a miss, by 1.5x as much").
// combat.tex "Explosions": "The damage from explosions is 150% on a
// critical" — the one attack whose degree can be the critical, the zone at
// its centre.
function afterDefense(facts: Damage, degree: Degree, target: Character, damage: number): { damage: number; stopped: boolean } {
  if (degree === 'hit') return { damage, stopped: false }
  if (degree === 'critical') return { damage: Math.floor(1.5 * damage), stopped: false }
  switch (facts.defense) {
    case 'block':
    case 'guard':
      return { damage: Math.max(0, damage - (degree === 'graze' ? facts.block : Math.floor(1.5 * facts.block))), stopped: false }
    case 'intercept': {
      const margin = degree === 'graze' ? 5 : 8
      return facts.force >= getForce(target) + margin ? { damage, stopped: false } : { damage: 0, stopped: true }
    }
    default:
      return { damage: degree === 'graze' ? Math.floor(damage / 2) : 0, stopped: false }
  }
}

// combat.tex "Hand": "Hands have no armor unless the character is wearing
// gauntlets"; "Head": "Armor bypass at the head hits flesh, which ignores all
// armor". Bare flesh is the armor schema's own default.
function armorAt(target: Character, facts: Damage): Armor {
  const armor = getArmor(target)
  if (facts.location === 'hand' && !target.hasGauntlets) return { ...armor, name: 'flesh', material: 'flesh', RES: 0, protection: 0, INS: 0, properties: [] }
  if (facts.location === 'head' && facts.bypass) return { ...armor, name: 'flesh', material: 'flesh', RES: 0, protection: 0, INS: 0, properties: [] }
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
// target, the damage is blunt, otherwise, use the largest damage of the two,
// but apply the additional effects of both" — every kind carried is measured
// against its own armor value, the one that gets furthest past it causes the
// injury, and the blunt tier causes the blunt effects regardless. "What
// cuts?": harder than the target; combat.tex "Penetrating" buys the same
// hardness. "Armor Bypass" adds half the armor value to the damage.
// combat.tex "Electric damage": "only deals half IL damage per tier".
export function getOutcome(facts: Damage, degree: Degree, target: Character): Outcome {
  const armor = armorAt(target, facts)
  const TGH = getTGH(target)
  const armorHardness = getHardness(armor.material)
  const canCut = facts.hardness > armorHardness || (facts.penetrating && facts.hardness === armorHardness)

  const bypass = (value: number) => (facts.bypass ? Math.floor(value / 2) : 0)
  const measured = facts.damage
    .filter(({ kind }) => kind !== 'cut' || canCut)
    .map(({ kind, value }) => {
      const against = armorValue(armor, kind)
      const left = afterDefense(facts, degree, target, value + bypass(against))
      return { type: kind, damage: left.damage, armor: against, tier: tierOf(left.damage, against, TGH), stopped: left.stopped }
    })
  if (measured.some((m) => m.stopped)) return { ...NOTHING, stopped: true }

  const tiers = Object.fromEntries(measured.map((m) => [m.type, m.tier])) as Outcome['tiers']
  const best = measured.reduce<(typeof measured)[number] | null>((b, m) => (b === null || m.damage - m.armor > b.damage - b.armor ? m : b), null)
  if (!best || best.tier === null) return { ...NOTHING, ...(best ? { type: best.type, damage: best.damage, armor: best.armor } : {}), tiers }

  const cap = LOCATIONS[facts.location].maxTier
  const bodyTier = cap === null ? best.tier : Math.min(best.tier, cap)
  const row = injuryMap[`T${bodyTier}`]
  // gear.tex "Piercing": "half the amount of IL damage per tier to body and
  // limb and cannot amputate"
  const piercing = hasProperty(facts.properties, 'piercing')
  const halved = piercing || best.type === 'electric'

  return {
    type: best.type,
    damage: best.damage,
    armor: best.armor,
    tier: best.tier,
    tiers,
    stopped: false,
    bodyTier,
    IL: halved ? Math.floor(row.IL / 2) : row.IL,
    // combat.tex "Bleed": "is caused by blunt and cutting damage"
    bleed: best.type === 'blunt' || best.type === 'cut' ? row.bleed : 0,
    ...effectsOf(facts, target, best.tier, tiers, piercing),
  }
}

// combat.tex "Hand": the hand a wound takes is "the hand used for defense" —
// the one holding what the target blocked or intercepted with, or the free
// hand that is the natural weapon. A hand aimed at with nothing in the way
// is the first one.
function woundedHand(facts: Damage, target: Character): number {
  const wielded = getWieldedWeapons(target).find((w) => w.key === facts.defenseWeaponKey)
  if (!wielded) return 0
  const index = target.hands.findIndex((hand) =>
    wielded.natural ? hand.itemId === '' && hand.naturalWeapon === wielded.weapon.name : hand.itemId === wielded.itemId)
  return Math.max(0, index)
}

// combat.tex "Additional effects", "Localized damage", "Wounds": what the
// tier does beyond IL. Interruption on T1+ blunt; stun on T3+ blunt, or when
// smash upgrades the interruption (combat.tex "Electric damage": "It causes
// interruptions and stuns" the same way); the location's wound at its tier,
// the worst one the tier reaches (Shocked is measured on the blunt tier and
// needs a smash); the head knocks out on a stun and kills at T4. A stun's AP
// comes off whatever the target has, on top of what the reaction cost.
// combat.tex "Burn, radiant": "Dealing Tier 0 injury or higher leaves the
// target burning"; "Corrosive": "Tiers 0 to I of damage leaves the target
// corroding at that tier of damage" — and past T1, still at that (the table's ruling).
function effectsOf(facts: Damage, target: Character, tier: number, tiers: Outcome['tiers'], piercing: boolean): Pick<Outcome, 'wound' | 'afflictions' | 'interruption' | 'apLoss' | 'dead'> {
  const bluntTier = Math.max(tiers.blunt ?? -1, tiers.electric ?? -1)
  const interrupted = bluntTier >= 1
  const stunned = bluntTier >= STUN_TIER || (facts.smash && interrupted)
  const afflictions = new Set<AfflictionKey>()
  let dead = false
  if (Math.max(tiers.burn ?? -1, tiers.radiant ?? -1) >= 0) afflictions.add('burning')
  if (tiers.corrosive === 0) afflictions.add('corroding0')
  if ((tiers.corrosive ?? -1) >= 1) afflictions.add('corroding1')

  const reached = (Object.keys(WOUNDS) as WoundKey[])
    .map((key) => ({ key, ...WOUNDS[key] }))
    .filter((w) => w.location === facts.location)
    .filter((w) => (w.smash ? facts.smash && bluntTier >= w.tier : tier >= w.tier))
    .filter((w) => !(piercing && w.amputation))
  const worst = reached[reached.length - 1]
  const wound: Outcome['wound'] = worst
    ? { key: worst.key, name: worst.name, heal: worst.heal, hand: worst.location === 'hand' ? woundedHand(facts, target) : null }
    : null
  if (worst?.affliction) afflictions.add(worst.affliction)
  if (facts.location === 'head') {
    if (stunned) afflictions.add('unconscious')
    if (tier >= HEAD.death) dead = true
  }

  return {
    wound,
    afflictions: [...afflictions],
    interruption: stunned ? 'stunned' : interrupted ? 'interrupted' : 'none',
    apLoss: stunned ? STUN_AP : 0,
    dead,
  }
}
