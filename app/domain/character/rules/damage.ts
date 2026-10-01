import type { AfflictionKey, Armor, BodyPart, Character, Damage, DamageKind, Degree, Interruption } from '../../types'
import { HEAD, LOCATIONS, MAX_TIER, STUN_AP, STUN_TIER, WOUNDS, WoundKey, injuryMap } from '../../tables'
import { getArmor, isVisorClosed } from './armor'
import { getTGH } from './misc'
import { getForce } from './skills'
import { getHardness } from '../../item/rules/items'
import { getNaturalWeapon, getWieldedWeapons } from '../../item/rules/hands'
import { isPartWounded } from './wounds'
import { hasProperty } from '../../weaponProperties'
import { isCampaignCharacter } from '../../utils'

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
  // combat.tex "Wounds": the wound the tier causes, and the part it takes
  wound: { key: WoundKey; name: string; heal: number | null; part: { id: string; name: string } } | null
  afflictions: AfflictionKey[]
  // combat.tex "Interruption", "Stun": what cuts the target's action short,
  // and the AP a stun takes on top
  interruption: Interruption
  apLoss: number
  dead: boolean
  // combat.tex "Burning and radiant damage": the burning counter once the
  // burn received has been added and the damage applied; null when no burn
  // was received
  burning: number | null
}

const NOTHING: Outcome = { stopped: false, type: 'blunt', damage: 0, armor: 0, tier: null, tiers: {}, bodyTier: null, IL: 0, bleed: 0, wound: null, afflictions: [], interruption: 'none', apLoss: 0, dead: false, burning: null }

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

// combat.tex "Damage absorption": "The attack's damage is zero if absorption
// value >= damage, halved if absorption value >= damage/2, and full if
// absorption value < damage/2" — the share of the damage that gets past.
function getAbsorbedShare(damage: number, value: number): number {
  if (value >= damage) return 0
  if (value >= damage / 2) return 0.5
  return 1
}

// combat.tex "Block", "Guard": the share of the measured damage a block or a
// guard that met the blow lets past — the block value absorbs a graze, and
// "A miss increases block value by 50%", a shield absorbing no more than its
// RES however it was met (the table's ruling); null when no block met it.
function getBlockShare(facts: Damage, degree: Degree, measured: number): number | null {
  if ((degree !== 'graze' && degree !== 'miss') || (facts.defense !== 'block' && facts.defense !== 'guard')) return null
  const value = degree === 'miss' ? Math.floor(1.5 * facts.block) : facts.block
  return getAbsorbedShare(measured, facts.blockCap === null ? value : Math.min(value, facts.blockCap))
}

// combat.tex "Intercept": a graze or a miss intercepted stops the blow,
// unless the attacker's Force outdoes the defender's by 5 on a graze or 8 on
// a miss.
function isIntercepted(facts: Damage, degree: Degree, target: Character): boolean {
  if (facts.defense !== 'intercept' || (degree !== 'graze' && degree !== 'miss')) return false
  return facts.force < getForce(target) + (degree === 'graze' ? 5 : 8)
}

// Each kind the blow carries as it arrives — "Armor Bypass" adds half the
// armor value — against its own armor value, and the measured one: the kind
// that gets furthest past its armor, which the injury and the absorption
// are read off (combat.tex "Physical attacks").
type Arriving = { type: DamageKind; value: number; against: number }

function getArriving(facts: Damage, target: Character): { arriving: Arriving[]; measured: Arriving | null } {
  const armor = armorAt(target, facts)
  const armorHardness = getHardness(armor.material)
  const canCut = facts.hardness > armorHardness || (facts.bust && facts.hardness === armorHardness)
  const bypass = (value: number) => (facts.bypass ? Math.floor(value / 2) : 0)
  const arriving = facts.damage
    .filter(({ kind }) => kind !== 'cut' || canCut)
    .map(({ kind, value }) => {
      const against = armorValue(armor, kind)
      return { type: kind, value: value + bypass(against), against }
    })
  const measured = arriving.reduce<Arriving | null>((b, a) => (b === null || a.value - a.against > b.value - b.against ? a : b), null)
  return { arriving, measured }
}

// combat.tex "Strike", "Defend": what the degree and the defense leave of the
// damage. A hit is always full. Without an object in the way a graze is half
// and a miss nothing; a block absorbs the measured damage at its block value
// (combat.tex "Damage absorption"), every kind at once; an intercept stops
// the blow outright, or lets it through whole.
// combat.tex "Accuracy", "Reflex": a shot the same — "Grazes deal 50%
// damage and misses do nothing"; a guard is a block.
// combat.tex "Explosions": "The damage from explosions is 150% on a
// critical" — the one attack whose degree can be the critical, the zone at
// its centre.
function afterDefense(facts: Damage, degree: Degree, damage: number, blockShare: number | null): number {
  if (blockShare !== null) return Math.floor(damage * blockShare)
  if (facts.defense === 'intercept' && (degree === 'graze' || degree === 'miss')) return damage
  return getUndefendedDamage(damage, degree)
}

// The kinds dealt through the burning counter.
function isBurning(kind: DamageKind): boolean {
  return kind === 'burn' || kind === 'radiant'
}

// What a degree leaves of damage nothing was put in the way of.
export function getUndefendedDamage(damage: number, degree: Degree): number {
  switch (degree) {
    case 'critical': return Math.floor(1.5 * damage)
    case 'hit': return damage
    case 'graze': return Math.floor(damage / 2)
    case 'miss': return 0
  }
}

// combat.tex "Hand": "Hands have no armor unless the character is wearing
// gauntlets"; "Head": "Armor bypass at the head hits flesh, which ignores all
// armor" — unless a closed helmet's visor is down (gear.tex "Closed helmet":
// "armor bypass is impossible in the head"). Bare flesh is the armor
// schema's own default.
function armorAt(target: Character, facts: Damage): Armor {
  const armor = getArmor(target)
  if (facts.location === 'hand' && !target.hasGauntlets) return { ...armor, name: 'flesh', material: 'flesh', RES: 0, protection: 0, INS: 0, properties: [] }
  if (facts.location === 'head' && facts.bypass && !isVisorClosed(target)) return { ...armor, name: 'flesh', material: 'flesh', RES: 0, protection: 0, INS: 0, properties: [] }
  return armor
}

// combat.tex "Damage Tiers": tier N is met at armor + N x TGH.
export function getTierThreshold(armor: number, TGH: number, tier: number): number {
  return armor + tier * TGH
}

// The tier the damage reaches: below the armor there is no injury, and
// neither is there from a blow that carries no damage at all — a miss, a
// grapple — however bare the target.
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
// combat.tex "Burning and radiant damage": "Every time burning damage is
// received, the burning counter is updated with the current burning value +
// incoming burning damage, and that total is used against INS to determine
// the injury. After the damage is applied, the burning counter is halved.
// Burning damage causes only half IL injury." Radiant damage is dealt the
// same way (the table's ruling); only its defense may differ.
export function getOutcome(facts: Damage, degree: Degree, target: Character): Outcome {
  const TGH = getTGH(target)
  const counter = isCampaignCharacter(target) ? target.injuries.burning : 0
  if (isIntercepted(facts, degree, target)) return { ...NOTHING, stopped: true }
  const { arriving, measured: top } = getArriving(facts, target)
  const blockShare = getBlockShare(facts, degree, top?.value ?? 0)
  const measured = arriving.map(({ type, value, against }) => {
    const left = afterDefense(facts, degree, value, blockShare)
    const damage = isBurning(type) && left > 0 ? left + counter : left
    return { type, damage, armor: against, tier: tierOf(damage, against, TGH) }
  })

  const burnt = measured.find((m) => isBurning(m.type) && m.damage > 0)
  const burning = burnt ? Math.floor(burnt.damage / 2) : null
  const tiers = Object.fromEntries(measured.map((m) => [m.type, m.tier])) as Outcome['tiers']
  const best = measured.reduce<(typeof measured)[number] | null>((b, m) => (b === null || m.damage - m.armor > b.damage - b.armor ? m : b), null)
  if (!best || best.tier === null) return { ...NOTHING, ...(best ? { type: best.type, damage: best.damage, armor: best.armor } : {}), tiers, burning }

  const cap = LOCATIONS[facts.location].maxTier
  const bodyTier = cap === null ? best.tier : Math.min(best.tier, cap)
  const row = injuryMap[`T${bodyTier}`]
  // gear.tex "Piercing": "half the amount of IL damage per tier to body and
  // limb and cannot amputate"
  const piercing = hasProperty(facts.properties, 'piercing')
  const halved = piercing || best.type === 'electric' || isBurning(best.type)

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
    burning,
  }
}

// combat.tex "Damage absorption": the share of a blow that hits several
// targets in a sequence still left once it is past this one. A block that
// met it absorbs first and the body second (the table's ruling), the body at
// its T2 damage — "For a character, the value equals to T2 damage", the
// measured kind's armor value and twice TGH. A blow that never touched them
// (a miss with nothing in its way) passes on whole; one an intercept stopped
// passes nothing on.
export function getPassedShare(facts: Damage, degree: Degree, target: Character): number {
  const { measured } = getArriving(facts, target)
  if (!measured || isIntercepted(facts, degree, target)) return 0
  const blockShare = getBlockShare(facts, degree, measured.value)
  if (degree === 'miss' && blockShare === null && facts.defense !== 'intercept') return 1
  const share = blockShare ?? 1
  return share * getAbsorbedShare(Math.floor(measured.value * share), getTierThreshold(measured.against, getTGH(target), 2))
}

// The part a blow at the location lands on: the one it was aimed at, while
// it is still there. combat.tex "Hand": otherwise the hand a wound takes is
// "the hand used for defense" — the one holding what the target blocked or
// intercepted with, or the free hand that is the natural weapon. Anywhere
// else, and a hand with nothing in the way, it is the first part there still
// whole. A creature with no such part left has none to take.
function woundedPart(facts: Damage, target: Character): BodyPart | null {
  const there = target.body.filter((part) => part.location === facts.location && !part.lost)
  const aimed = there.find((part) => part.id === facts.part)
  const wielded = facts.location === 'hand' ? getWieldedWeapons(target).find((w) => w.key === facts.defenseWeaponKey) : undefined
  const defending = wielded && there.find((part) =>
    wielded.natural ? part.itemId === '' && getNaturalWeapon(target, part) === wielded.weapon.name : part.itemId === wielded.itemId)
  return aimed ?? defending ?? there.find((part) => !isPartWounded(target, part.id)) ?? there[0] ?? null
}

// combat.tex "Additional effects", "Localized damage", "Wounds": what the
// tier does beyond IL. Interruption on T1+ blunt; stun on T3+ blunt, or when
// smash upgrades the interruption (combat.tex "Electric damage": "It causes
// interruptions and stuns" the same way); the location's wound at its tier,
// the worst one the tier reaches (Shocked is measured on the blunt tier and
// needs a smash); the head knocks out on a stun and kills at T4. A stun's AP
// comes off whatever the target has, on top of what the reaction cost.
// combat.tex "Corrosive": "Tiers 0 to I of damage leaves the target
// corroding at that tier of damage" — and past T1, still at that (the table's ruling).
function effectsOf(facts: Damage, target: Character, tier: number, tiers: Outcome['tiers'], piercing: boolean): Pick<Outcome, 'wound' | 'afflictions' | 'interruption' | 'apLoss' | 'dead'> {
  const bluntTier = Math.max(tiers.blunt ?? -1, tiers.electric ?? -1)
  const interrupted = bluntTier >= 1
  const stunned = bluntTier >= STUN_TIER || (facts.smash && interrupted)
  const afflictions = new Set<AfflictionKey>()
  let dead = false
  if (tiers.corrosive === 0) afflictions.add('corroding0')
  if ((tiers.corrosive ?? -1) >= 1) afflictions.add('corroding1')

  const reached = (Object.keys(WOUNDS) as WoundKey[])
    .map((key) => ({ key, ...WOUNDS[key] }))
    .filter((w) => w.location === facts.location)
    .filter((w) => (w.smash ? facts.smash && bluntTier >= w.tier : tier >= w.tier))
    .filter((w) => !(piercing && w.amputation))
  const part = woundedPart(facts, target)
  const worst = part ? reached[reached.length - 1] : undefined
  const wound: Outcome['wound'] = worst && part
    ? { key: worst.key, name: worst.name, heal: worst.heal, part: { id: part.id, name: part.name } }
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
