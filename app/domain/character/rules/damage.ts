import type { AfflictionKey, Armor, BodyPart, Character, Condition, Damage, DamageKind, Degree, Interruption, Outcome, OutcomeStep, PartWound } from '../../types'
import { BLUNT_EFFECT_TIERS, MAX_TIER, STUN_AP, injuryMap } from '../../tables'
import { getArmor } from './armor'
import { getTGH } from './misc'
import { getForce } from './skills'
import { getHardness } from '../../item/rules/items'
import { getNaturalWeapon, getWieldedWeapons } from '../../item/rules/hands'
import { isPartWounded } from './wounds'
import { getPlace, type Place } from './body'
import { hasProperty } from '../../weaponProperties'
import { isCampaignCharacter } from '../../utils'

// What damage does to this character: the one place the injury rules are
// read. It takes the damage as delivered and the degree it lands at, and
// answers with nothing but the character's own armor and toughness — the
// producer has already said everything else.

export type { Outcome, OutcomeStep } from '../../types'

// combat.tex "Cutting damage": poison lands "when damage is at least T0" —
// what a follow-up asks of its parent's outcome before it is delivered.
export function passesCondition(when: Condition | null, outcome: Outcome | null): boolean {
  if (when === null) return true
  if (when.minTier !== null && (outcome === null || outcome.tier === null || outcome.tier < when.minTier)) return false
  return true
}

// combat.tex "Interruption", "Stun": of two interruptions landed together,
// the stronger, never both.
const INTERRUPTIONS: readonly Interruption[] = ['none', 'interrupted', 'stunned']
export function strongerInterruption(a: Interruption, b: Interruption): Interruption {
  return INTERRUPTIONS.indexOf(b) > INTERRUPTIONS.indexOf(a) ? b : a
}

const NOTHING: Outcome = { stopped: false, type: 'blunt', damage: 0, armor: 0, tier: null, tiers: {}, bodyTier: null, IL: 0, bleed: 0, wound: null, afflictions: [], interruption: 'none', apLoss: 0, dead: false, burning: null, arrived: { blunt: 0, cut: 0 } }

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
  if (facts.defense === 'blockExplosion') return getAbsorbedShare(measured, getBlockValue(facts, degree))
  if ((degree !== 'graze' && degree !== 'miss') || (facts.defense !== 'block' && facts.defense !== 'guard')) return null
  return getAbsorbedShare(measured, getBlockValue(facts, degree))
}

// What the block that met the blow absorbs at the degree: its value, "A miss
// increases block value by 50%", no more than the object's RES.
function getBlockValue(facts: Damage, degree: Degree): number {
  const value = degree === 'miss' ? Math.floor(1.5 * facts.block) : facts.block
  return facts.blockCap === null ? value : Math.min(value, facts.blockCap)
}

// combat.tex "Intercept": a graze or a miss intercepted stops the blow,
// unless the attacker's Force outdoes the defender's by 5 on a graze or 8 on
// a miss.
function isIntercepted(facts: Damage, degree: Degree, target: Character): boolean {
  if (facts.defense !== 'intercept' || (degree !== 'graze' && degree !== 'miss')) return false
  return facts.force < getForce(target) + (degree === 'graze' ? 5 : 8)
}

// Each kind the blow carries as it arrives against its own armor value, and
// the measured one: the kind
// that gets furthest past its armor, which the injury and the absorption
// are read off (combat.tex "Physical attacks").
type Arriving = { type: DamageKind; value: number; against: number }

// combat.tex "What cuts?": "A weapon can cut something if their hardness is
// higher than their target's"; "Bust" buys the same hardness.
function canCutArmor(facts: Damage, armor: Armor): boolean {
  const armorHardness = getHardness(armor.material)
  return facts.hardness > armorHardness || (facts.bust && facts.hardness === armorHardness)
}

// combat.tex "Cover": a wall that breaks in the blow's way absorbs the
// measured damage at its RES as it arrives, before the degree or any defense
// meets what is left; `wall` is the share it lets past.
function getArriving(facts: Damage, target: Character): { arriving: Arriving[]; measured: Arriving | null; wall: number } {
  const armor = armorAt(target, facts)
  const canCut = canCutArmor(facts, armor)
  const sent = facts.damage.map(({ kind, value }) => {
    const against = armorValue(armor, kind)
    const carried = kind === 'cut' && !canCut ? Math.floor(value / 2) : value
    return { type: kind, value: carried, against }
  })
  const sentMeasured = getMeasured(sent)
  const wall = facts.wall && sentMeasured ? getAbsorbedShare(sentMeasured.value, facts.wall.RES) : 1
  const arriving = sent.map((a) => ({ ...a, value: Math.floor(a.value * wall) }))
  return { arriving, measured: getMeasured(arriving), wall }
}

function getMeasured(arriving: Arriving[]): Arriving | null {
  return arriving.reduce<Arriving | null>((b, a) => (b === null || a.value - a.against > b.value - b.against ? a : b), null)
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
// combat.tex "Explosion Block": the shield's defenses reduce the explosion's
// damage, which its zone has scaled already.
function afterDefense(facts: Damage, degree: Degree, damage: number, blockShare: number | null): number {
  if (facts.defense === 'blockExplosion' && blockShare !== null) return Math.floor(getUndefendedDamage(damage, degree) * blockShare)
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

function arrivedOf(measured: { type: DamageKind; damage: number }[], kind: DamageKind): number {
  return measured.filter((m) => m.type === kind).reduce((sum, m) => sum + m.damage, 0)
}

// combat.tex "Hand": "Hands have no armor unless the character is wearing
// gauntlets", a flag of the part the blow lands on.
export function isArmorBare(target: Character, facts: Damage): boolean {
  if (facts.bare) return true
  return struckPlace(facts, target).flags.includes('bareWithoutGauntlets') && !target.hasGauntlets
}

// Bare flesh is the armor schema's own default.
function armorAt(target: Character, facts: Damage): Armor {
  const armor = getArmor(target)
  return isArmorBare(target, facts) ? { ...armor, name: 'flesh', material: 'flesh', RES: 0, protection: 0, INS: 0, properties: [] } : armor
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

// combat.tex "Physical attacks": "Use the largest damage of the two, but apply
// the additional effects of both. If the weapon is not capable of cutting its
// target, the cutting damage is halved" — every kind carried is measured
// against its own armor value, the one that gets furthest past it causes the
// injury, and the blunt tier causes the blunt effects regardless. "What
// cuts?": harder than the target; combat.tex "Penetrating" buys the same
// hardness.
// combat.tex "Electric damage": "only deals half IL damage per tier".
// combat.tex "Burning and radiant damage": "Every time burning damage is
// received, the burning counter is updated with the current burning value +
// incoming burning damage, and that total is used against INS to determine
// the injury. After the damage is applied, the burning counter is halved.
// Burning damage causes only half IL injury." Radiant damage is dealt the
// same way (the table's ruling); only its defense may differ. A searing burn
// leaves the counter alone.
export function getOutcome(facts: Damage, degree: Degree, target: Character): Outcome {
  const TGH = getTGH(target)
  const counter = isCampaignCharacter(target) && !facts.sear ? target.injuries.burning : 0
  if (isIntercepted(facts, degree, target)) return { ...NOTHING, stopped: true }
  const { arriving, measured: top } = getArriving(facts, target)
  const blockShare = getBlockShare(facts, degree, top?.value ?? 0)
  const measured = arriving.map(({ type, value, against }) => {
    const left = afterDefense(facts, degree, value, blockShare)
    const damage = isBurning(type) && left > 0 ? left + counter : left
    return { type, damage, armor: against, tier: tierOf(damage, against, TGH) }
  })

  const burnt = measured.find((m) => isBurning(m.type) && m.damage > 0)
  const burning = burnt && !facts.sear ? Math.floor(burnt.damage / 2) : null
  const arrived = { blunt: arrivedOf(measured, 'blunt'), cut: arrivedOf(measured, 'cut') }
  const tiers = Object.fromEntries(measured.map((m) => [m.type, m.tier])) as Outcome['tiers']
  const best = measured.reduce<(typeof measured)[number] | null>((b, m) => (b === null || m.damage - m.armor > b.damage - b.armor ? m : b), null)
  if (!best || best.tier === null) return { ...NOTHING, ...(best ? { type: best.type, damage: best.damage, armor: best.armor } : {}), tiers, burning, arrived }

  const cap = struckPlace(facts, target).maxTier
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
    // the table's ruling: a blow that reaches a tier deals at least 1 IL
    IL: halved ? Math.max(1, Math.floor(row.IL / 2)) : row.IL,
    // combat.tex "Bleed": "is caused by blunt and cutting damage"
    bleed: best.type === 'blunt' || best.type === 'cut' ? row.bleed : 0,
    ...effectsOf(facts, target, best.tier, tiers, piercing),
    burning,
    arrived,
  }
}

// combat.tex "Damage absorption": the share of a blow that hits several
// targets in a sequence still left once it is past this one. A block that
// met it absorbs first and the body second (the table's ruling), the body at
// its T2 damage — "For a character, the value equals to T2 damage", the
// measured kind's armor value and twice TGH, after a wall that breaks in the
// way. A blow that never touched them (a miss with nothing in its way) passes
// on whole; one an intercept stopped passes nothing on.
export function getPassedShare(facts: Damage, degree: Degree, target: Character): number {
  const { measured, wall } = getArriving(facts, target)
  if (!measured || isIntercepted(facts, degree, target)) return 0
  const blockShare = getBlockShare(facts, degree, measured.value)
  if (degree === 'miss' && blockShare === null && facts.defense !== 'intercept') return wall
  const share = blockShare ?? 1
  return wall * share * getAbsorbedShare(Math.floor(measured.value * share), getTierThreshold(measured.against, getTGH(target), 2))
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

function struckPlace(facts: Damage, target: Character): Place {
  return getPlace(woundedPart(facts, target), facts.location)
}

// combat.tex "Wounds": the worst of the part's wounds the tier reaches —
// the highest, the later of two at one tier. A blunt wound (Shocked) is
// measured on the blunt tier; gear.tex "Piercing": "cannot amputate".
function reachedWound(place: Place, tier: number, bluntTier: number, piercing: boolean): PartWound | null {
  return place.wounds
    .filter((w) => (w.blunt ? bluntTier >= w.tier : tier >= w.tier))
    .filter((w) => !(piercing && w.effect === 'sever'))
    .reduce<PartWound | null>((worst, w) => (worst === null || w.tier >= worst.tier ? w : worst), null)
}

// combat.tex "Additional effects", "Localized damage", "Wounds": what the
// tier does beyond IL. Interruption on T1+ blunt and stun on T3+ blunt, T0
// and T2 from a basher (combat.tex "Electric damage": "It causes
// interruptions and stuns" the same way); the worst wound of the part the
// tier reaches, which may take the part off or kill. A part flagged so (the
// head) raises each a step: "Interrupts become stuns, and stuns become
// unconsciousness". A stun's AP comes off whatever the target has, on top of
// what the reaction cost.
// combat.tex "Corrosive": "Tiers 0 to I of damage leaves the target
// corroding at that tier of damage" — and past T1, still at that (the table's ruling).
// The tiers the blunt effects start at for the blow, and whether the place it
// lands on raises them a step.
function getBluntRule(facts: Damage, place: Place): { basher: boolean; interrupt: number; stun: number; raised: boolean } {
  const basher = hasProperty(facts.properties, 'basher')
  return { basher, ...BLUNT_EFFECT_TIERS[basher ? 'basher' : 'normal'], raised: place.flags.includes('stunUnconscious') }
}

function effectsOf(facts: Damage, target: Character, tier: number, tiers: Outcome['tiers'], piercing: boolean): Pick<Outcome, 'wound' | 'afflictions' | 'interruption' | 'apLoss' | 'dead'> {
  const bluntTier = Math.max(tiers.blunt ?? -1, tiers.electric ?? -1)
  const place = struckPlace(facts, target)
  const rule = getBluntRule(facts, place)
  const interrupted = bluntTier >= rule.interrupt
  const stunnedThere = bluntTier >= rule.stun
  const afflictions = new Set<AfflictionKey>()
  let dead = false
  if (tiers.corrosive === 0) afflictions.add('corroding0')
  if ((tiers.corrosive ?? -1) >= 1) afflictions.add('corroding1')

  const stunned = stunnedThere || (rule.raised && interrupted)
  const worst = reachedWound(place, tier, bluntTier, piercing)
  const wound: Outcome['wound'] = worst && place.part && worst.effect !== 'kill'
    ? { name: worst.name, heal: worst.effect === 'sever' ? null : worst.heal, part: { id: place.part.id, name: place.part.name } }
    : null
  if (worst?.effect === 'kill') dead = true
  else if (worst?.affliction) afflictions.add(worst.affliction)
  if (stunnedThere && rule.raised) afflictions.add('unconscious')

  return {
    wound,
    afflictions: [...afflictions],
    interruption: stunned ? 'stunned' : interrupted ? 'interrupted' : 'none',
    apLoss: stunned ? STUN_AP : 0,
    dead,
  }
}

// ---------------------------------------------------------------------------
// The workings

const DEGREE_SHARE: Record<Exclude<Degree, 'miss'>, string> = { critical: 'a critical deals 150% of the damage', hit: 'a hit deals the full damage', graze: 'a graze deals half the damage' }

// How `getOutcome` came to its result, a step at a time, each with the rule it
// follows: what the blow carried, what it was measured against, what the
// degree and the defense left of it, the tier, and every effect the tier had.
// What it arrives at is read off the outcome itself; only the reasons between
// are put into words here.
export function explainOutcome(facts: Damage, degree: Degree, target: Character): OutcomeStep[] {
  const outcome = getOutcome(facts, degree, target)
  const step = (text: string, rule: string): OutcomeStep => ({ text, rule })
  if (outcome.stopped) return [step('intercepted: the blow never lands', 'combat.tex "Intercept"')]

  const armor = armorAt(target, facts)
  const { arriving, measured, wall } = getArriving(facts, target)
  const share = (s: number) => (s === 0 ? 'none' : s === 0.5 ? 'half' : 'all')
  const steps: OutcomeStep[] = [
    step(`the blow carries ${facts.damage.map((d) => `${d.value} ${d.kind}`).join(' + ') || 'no damage'}${facts.location === 'chest' ? '' : `, aimed at the ${facts.location}`}`, 'combat.tex "Physical attacks"'),
  ]
  if (isArmorBare(target, facts)) steps.push(step(`no armor at the ${facts.location}: flesh`, 'combat.tex "Localized damage"'))
  if (facts.damage.some((d) => d.kind === 'cut') && !canCutArmor(facts, armor)) {
    steps.push(step(`cutting cannot cut ${armor.name}, so its damage is halved (hardness ${facts.hardness} against ${getHardness(armor.material)})`, 'combat.tex "What cuts?"'))
  }
  if (facts.wall) steps.push(step(`the wall in the way, RES ${facts.wall.RES}, lets ${share(wall)} of the damage past`, 'combat.tex "Cover", "Damage absorption"'))
  for (const a of arriving) {
    steps.push(step(`${a.type} ${a.value} is measured against ${armor.name} ${armorValueName(a.type)} ${a.against}`, 'combat.tex "Types of damage"'))
  }

  const blockShare = measured ? getBlockShare(facts, degree, measured.value) : null
  if (blockShare !== null && measured) {
    steps.push(step(`${facts.defense} value ${getBlockValue(facts, degree)} against ${measured.value} damage lets ${share(blockShare)} of it past`, 'combat.tex "Damage absorption"'))
  } else if (facts.defense === 'intercept' && (degree === 'graze' || degree === 'miss')) {
    steps.push(step('the intercept did not stop the blow: it comes through whole', 'combat.tex "Intercept"'))
  } else {
    steps.push(step(degree === 'miss' ? 'a miss does nothing' : DEGREE_SHARE[degree], 'combat.tex "Strike", "Defend"'))
  }
  if (isBurning(outcome.type) && outcome.burning !== null) steps.push(step(`the burning counter is added, and halved afterwards to ${outcome.burning}`, 'combat.tex "Burning and radiant damage"'))

  if (outcome.tier === null) {
    steps.push(step(`${outcome.damage} ${outcome.type} is below the armor value ${outcome.armor}: no injury`, 'combat.tex "Damage Tiers"'))
    return steps
  }
  steps.push(step(`${outcome.damage} against armor ${outcome.armor}: tier ${outcome.tier} (tier N is met at armor + N x TGH ${getTGH(target)})`, 'combat.tex "Damage Tiers"'))
  if (outcome.bodyTier !== outcome.tier) steps.push(step(`a blow to the ${facts.location} puts at most tier ${outcome.bodyTier} on the body`, 'combat.tex "Localized damage"'))
  const table = injuryMap[`T${outcome.bodyTier}`]
  const halved = outcome.IL !== table.IL
  steps.push(step(`tier ${outcome.bodyTier} is +${table.IL} IL${halved ? `, halved to +${outcome.IL} (${hasProperty(facts.properties, 'piercing') ? 'piercing' : outcome.type})` : ''}`, 'combat.tex "Damage Tiers"'))
  if (outcome.bleed > 0) steps.push(step(`blunt and cutting damage bleed: +${outcome.bleed}`, 'combat.tex "Bleed"'))
  const { basher, interrupt, stun, raised } = getBluntRule(facts, struckPlace(facts, target))
  const from = basher ? ' from a basher' : ''
  if (outcome.interruption === 'interrupted') steps.push(step(`a tier ${interrupt}+ blunt or electric injury${from} interrupts: the action and its cost are lost`, basher ? 'gear.tex "Basher"' : 'combat.tex "Interruption"'))
  if (outcome.interruption === 'stunned') steps.push(step(`a tier ${stun}+ blunt or electric injury${from}${raised ? `, or an interruption at the ${facts.location},` : ''} stuns: ${outcome.apLoss} AP are lost as well`, raised ? 'combat.tex "Head"' : basher ? 'gear.tex "Basher"' : 'combat.tex "Stun"'))
  if (outcome.wound) steps.push(step(`${outcome.wound.name} on the ${outcome.wound.part.name}${outcome.wound.heal === null ? ', which does not heal' : `, healed at ${outcome.wound.heal} IL`}`, 'combat.tex "Wounds"'))
  for (const a of outcome.afflictions) steps.push(step(`now ${a}`, a === 'unconscious' ? 'combat.tex "Localized damage"' : 'combat.tex "Afflictions"'))
  if (outcome.dead) steps.push(step(`tier ${outcome.tier} at the ${struckPlace(facts, target).part?.name ?? facts.location} is instant death`, 'combat.tex "Localized damage"'))
  return steps
}

// The armor value a kind is defended by, by name.
function armorValueName(kind: DamageKind): string {
  switch (kind) {
    case 'blunt': return 'protection'
    case 'cut': return 'RES'
    default: return 'INS'
  }
}
