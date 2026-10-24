import { CampaignCharacter, Character, Charge, ChargeTrigger, Grant, Item, Requirement, Skills, Spell, SpellMethod, SpellMethodSchema } from '../../types'
import { SPELLS, SpellKey, getSpellOutcomes, isSpellKey } from '../../spells'
import { EXTEND, HIT_MARGIN, QUICKEN_DL } from '../../tables'
import { getCharisma, getDevotion, getSPI } from './characteristics'
import { getDivine, getMiracle, getSchoolCasting } from './magic'
import { getAccuracy, getStrike, skillTermGetters } from './skills'
import type { Term } from './terms'
import { MAX_SIZE, getSM, getVMAt, getSize } from './size'
import { getKnowledge } from './knowledge'
import { canAfford, canAffordOrHold } from './cost'
import { getActionCost, type ActionCost } from './actionCosts'
import { getCarriedItems, getItemScale, hasAmmo, isGear, isMetalWeapon } from '../../item/rules/items'
import { getReadyItems } from '../../item/rules/containers'
import { isCampaignCharacter } from '../../utils'
import { ABILITIES, getLearnedAbilityKeys, hasAbility, isAbilityKey } from '../../abilities'
import { mayCastWhileConcentrating } from './concentration'
import { hasGrant, isAbilityActive, isSpellActive } from './effects'
import { getUnmetRequirements, holdsRequirement, requirementLabel, requirementsLabel } from './requirements'

// spells.tex "Learning spells".

// The highest knowledge requirement a spell names — what a miracle is measured
// against and what the intuitive route caps at.
function requirementLevel(spell: Spell): number {
  return Math.max(0, ...spell.knowledge.map((k) => k.level))
}

// The knowledge a wizard casts this spell with: the highest the character
// holds among those the spell names, the spell's own school when it names
// none.
export function getCastingKnowledge(c: Character, spell: Spell): string {
  const named = spell.knowledge.map((k) => k.name)
  if (named.length === 0) return spell.section
  return named.reduce((best, name) => (getKnowledge(name)(c) > getKnowledge(best)(c) ? name : best))
}

export function getMethodSkill(c: Character, spell: Spell, method: SpellMethod): number {
  switch (method) {
    case 'wizard': return getSchoolCasting(getCastingKnowledge(c, spell))(c)
    case 'cleric': return getDivine(c)
    case 'intuitive': return 0
  }
}

// "it is possible to improve on a specific spell starting at the skill level
// that the character has when they learn it" — practice is a floor raised
// with XP, never below what the method gives for free.
export function getSpellSkill(c: Character, key: SpellKey): number {
  const learned = c.spells[key]
  if (!learned) return 0
  return Math.max(learned.practice, getMethodSkill(c, SPELLS[key], learned.method))
}

// "-3 penalty on the test per devotion level under the spell's knowledge
// requirement"
export function getMiracleSkill(c: Character, key: SpellKey): number {
  const shortfall = Math.max(0, requirementLevel(SPELLS[key]) - getDevotion(c))
  return getMiracle(c) - 3 * shortfall
}

// Why each method refuses a spell, in words a player can act on; '' where it
// does not. "It is not possible to learn spells with knowledge requirements
// above 3 this way" caps the intuitive route; the wizard and cleric routes
// are opened by their abilities (abilities.tex "Magic Theory", "Cleric"),
// and every route by what the spell is learned from (spells.tex
// "Requirements"). Everything else the book asks of learning (XP, the
// grimoire test, the deity's list) is the table's.
const METHOD_GRANT: Record<SpellMethod, Grant | null> = { intuitive: null, wizard: 'wizardSpells', cleric: 'clericSpells' }

const GRANTED_BY = Object.values(ABILITIES).reduce((names, a) => {
  for (const g of a.grants) names.set(g, names.has(g) ? `${names.get(g)} or ${a.name}` : a.name)
  return names
}, new Map<Grant, string>())

export function getSpellLearnBlocks(key: SpellKey): (c: Character) => Record<SpellMethod, string> {
  return (c: Character) => {
    const unmet = key in c.spells ? [] : getUnmetRequirements(c, SPELLS[key].requirements)
    const block = (method: SpellMethod): string => {
      if (key in c.spells) return 'learned'
      if (unmet.length) return `needs ${unmet.join(' · ')}`
      const grant = METHOD_GRANT[method]
      if (!grant) return requirementLevel(SPELLS[key]) <= 3 ? '' : 'knowledge above 3'
      return hasGrant(c, grant) ? '' : `needs ${GRANTED_BY.get(grant) ?? grant}`
    }
    return Object.fromEntries(SpellMethodSchema.options.map((method) => [method, block(method)])) as Record<SpellMethod, string>
  }
}

export function canLearnSpell(key: SpellKey, method: SpellMethod): (c: Character) => boolean {
  return (c: Character) => getSpellLearnBlocks(key)(c)[method] === ''
}

// abilities.tex "Magic Theory": "Learns two spells for which the character
// has knowledge" — every knowledge the spell names, at its level. The count
// is what the abilities learned give.
export function hasSpellKnowledge(c: Character, key: SpellKey): boolean {
  return SPELLS[key].knowledge.every((k) => getKnowledge(k.name)(c) >= k.level)
}

export function getFreeSpellCount(c: Character): number {
  return getLearnedAbilityKeys(c).reduce((sum, key) => sum + ABILITIES[key].freeSpells, 0)
}

// A spell that can be taken as one of those: learnable as a wizard, with the
// knowledge for it.
export function canClaimFreeSpell(key: SpellKey): (c: Character) => boolean {
  return (c: Character) => canLearnSpell(key, 'wizard')(c) && hasSpellKnowledge(c, key)
}

// spells.tex "Casting spells": the DL a cast is rolled against, raised by
// Quicken when the caster forgoes the focus surge, and by what the links the
// caster holds add (spells.tex "Telepathic Link"), `linkDL`.
export function getCastingDL(spell: Spell, quicken: boolean, extend = 0, linkDL = 0): number | null {
  return spell.DL === null ? null : spell.DL + (quicken ? QUICKEN_DL : 0) + extend * EXTEND.DL + linkDL
}

// play.tex "Degrees of success": a hit is the DL + 5.
export function isHit(score: number, DL: number): boolean {
  return score >= DL + HIT_MARGIN
}

// spells.tex "Requirements": "Some spells may even be impossible to cast if
// the minimum conditions are not met." The gear a spell names has to be at
// hand, in the caster's hands or a quick slot.
function getGearRequirements(key: SpellKey): Requirement[][] {
  return SPELLS[key].castRequirements.map((item) => item.filter((alt) => alt.kind === 'gear')).filter((item) => item.length > 0)
}

// spells.tex "Relationship between Size and Sorcery": "Any spell that has
// DM, SM, RM or VM marked in it is scaled to character size". A shamanism
// spell is scaled to its environment instead, which the fight does not
// model yet: it stands at the standard size.
const ENVIRONMENT_SIZE = 3

export function getSpellBaseSize(c: Character, key: SpellKey): number {
  return SPELLS[key].section === 'shamanism' ? ENVIRONMENT_SIZE : getSize(c)
}

// Whether anything in the spell is marked to scale — what "Amplify Spell"
// asks before it can be bought.
export function isScaledSpell(key: SpellKey): boolean {
  const spell = SPELLS[key]
  const all = getSpellOutcomes(spell)
  const outcomes = all ? Object.values(all).flatMap((o) => o.effects) : []
  return spell.effects.some((e) => e.scales.damage || e.scales.area || e.scales.reach) || outcomes.some((e) => e.scales.damage)
}

// "It is possible to use an item requirement up to 1 size larger than the
// character, but it is necessary to amplify the spell to use it" — so a
// larger one only serves a spell that can be amplified.
function fitsSpell(c: Character, key: SpellKey, item: Item): boolean {
  return getItemScale(item) <= getSpellBaseSize(c, key) + (isScaledSpell(key) ? 1 : 0)
}

// Gear a cast can be started with: small enough, with the most charges an
// unamplified cast can draw from it left.
function servesSpell(c: Character, key: SpellKey, item: Item): boolean {
  return fitsSpell(c, key, item) && hasChargesFor(item, SPELLS[key].ammo, getCastSize(c, key, 0, item.id))
}

// spells.tex "Amplify Spell": "The amount of material or charges consumed
// is multiplied by the VM" — at the size the spell is cast at.
export function getChargeDraw(ammo: number, size: number): number {
  return ammo * getVMAt(size)
}

// A fraction of a charge is a chance to spend one more (the table's
// ruling): the whole charges, and one more when the percentile roll comes
// under the fraction.
export function countCharges(draw: number, roll: number): number {
  const whole = Math.floor(draw)
  const chance = Math.round((draw - whole) * 100)
  return whole + (chance > 0 && roll < chance ? 1 : 0)
}

// The charges drawn of `ammo` at a size, by the percentile roll thrown for
// it; and whether the item has the most that could come to.
export function drawCharges(ammo: number, size: number, roll: number): number {
  return countCharges(getChargeDraw(ammo, size), roll)
}

export function hasChargesFor(item: Item, ammo: number, size: number): boolean {
  return hasAmmo(item, drawCharges(ammo, size, -1))
}

// The gear at hand the spell is cast with, what is in the hands first.
export function getSpellGearOptions(c: Character, key: SpellKey): Item[] {
  const names = getGearRequirements(key).flat().filter((alt) => !alt.not).map((alt) => alt.name)
  return getReadyItems(c).filter((i) => names.some((name) => isGear(i, name)) && fitsSpell(c, key, i))
}

// The gear at hand a cast of the spell can be started with.
export function getCastableGear(c: Character, key: SpellKey): Item[] {
  return getSpellGearOptions(c, key).filter((i) => servesSpell(c, key, i))
}

// spells.tex "Charged": what a cast with this gear can be charged into —
// the gear itself, a metal weapon at hand ("Taser"), or food at hand
// ("Healing Food").
export function getChargeTargets(c: Character, key: SpellKey, gear: Item | null): Item[] {
  switch (SPELLS[key].chargeInto) {
    case 'gear': return gear ? [gear] : []
    case 'metalWeapon': return getReadyItems(c).filter(isMetalWeapon)
    case 'food': return getReadyItems(c).filter((i) => i.food !== null)
  }
}

// Whether a spell charged into something at hand has it; one charged into
// its gear has it once its requirements are met.
export function hasChargeTarget(c: Character, key: SpellKey): boolean {
  return SPELLS[key].chargeInto === 'gear' || getChargeTargets(c, key, null).length > 0
}

// spells.tex "Charged": what releases a charge — what its spell says.
export function hasChargeTrigger(charge: Charge, trigger: ChargeTrigger): boolean {
  return isSpellKey(charge.key) && SPELLS[charge.key].triggers.includes(trigger)
}

// The gear the cast is made with, whose size bounds the spell's and a charge
// is loaded into (spells.tex "Charged"): the one named, or else the first at
// hand. Null when none is.
export function getSpellGear(c: Character, key: SpellKey, itemId = ''): Item | null {
  return pickSpellGear(getSpellGearOptions(c, key), itemId)
}

export function pickSpellGear(options: Item[], itemId: string): Item | null {
  return options.find((i) => i.id === itemId) ?? options[0] ?? null
}

// spells.tex "Amplify Spell": "It is possible to amplify up to 1 size larger
// than the item requirement", and an item larger than the caster has to be
// amplified to — the fewest and the most amplifications the cast can have.
// Past the item's size + 1 the spell does not grow, so a small item holds
// it there even below the caster's own size.
export type AmplifyBounds = { min: number; max: number }

export function getAmplifyBounds(c: Character, key: SpellKey, itemId = ''): AmplifyBounds {
  if (!isScaledSpell(key)) return { min: 0, max: 0 }
  const base = getSpellBaseSize(c, key)
  const gear = getSpellGear(c, key, itemId)
  const top = gear ? Math.min(MAX_SIZE, getItemScale(gear) + 1) : MAX_SIZE
  return { min: gear ? Math.max(0, getItemScale(gear) - base) : 0, max: Math.max(0, top - base) }
}

// The size the spell is cast at: its base, one up per amplification, and
// never past the item's size + 1.
export function getCastSize(c: Character, key: SpellKey, amplify: number, itemId = ''): number {
  const gear = getSpellGear(c, key, itemId)
  const top = gear && isScaledSpell(key) ? getItemScale(gear) + 1 : MAX_SIZE
  return Math.max(1, Math.min(getSpellBaseSize(c, key) + amplify, top, MAX_SIZE))
}

function holdsGear(ready: Item[], c: Character, key: SpellKey, alt: Requirement): boolean {
  return ready.some((i) => isGear(i, alt.name) && (alt.not || servesSpell(c, key, i))) !== alt.not
}

// A passive ability is in effect for as long as it is learned; a toggle
// while switched on.
function isInEffect(c: Character, key: string): boolean {
  if (!isAbilityKey(key) || !hasAbility(c, key)) return false
  return ABILITIES[key].activation === 'passive' || isAbilityActive(c, key)
}

// One item of what a spell is cast with: the gear at hand, the spell held,
// the ability in effect. A condition is the table's to judge.
function holdsCastRequirement(ready: Item[], c: Character, key: SpellKey, alt: Requirement): boolean {
  switch (alt.kind) {
    case 'gear': return holdsGear(ready, c, key, alt)
    case 'sustaining': return (isSpellKey(alt.name) && isSpellActive(c, alt.name)) !== alt.not
    case 'active': return isInEffect(c, alt.name) !== alt.not
    case 'condition': return true
    default: return holdsRequirement(c, alt)
  }
}

// The items of what the spell is cast with that the caster is short of.
export function getUnmetCastRequirements(c: Character, key: SpellKey): Requirement[][] {
  const ready = getReadyItems(c)
  return SPELLS[key].castRequirements.filter((item) => !item.some((alt) => holdsCastRequirement(ready, c, key, alt)))
}

export function meetsCastRequirements(c: Character, key: SpellKey): boolean {
  return getUnmetCastRequirements(c, key).length === 0
}

// What stands between the caster and the spell, in the book's words, for
// the button that will not press: gear at hand only in a size too large to
// use, or carried but not at hand, says so.
export function getUnmetCastLabel(c: Character, key: SpellKey): string {
  const ready = getReadyItems(c)
  const carried = getCarriedItems(c)
  const label = (alt: Requirement): string => (alt.kind !== 'gear' || alt.not ? requirementLabel(alt)
    : ready.some((i) => isGear(i, alt.name) && fitsSpell(c, key, i)) ? `${alt.name} with charges left`
    : ready.some((i) => isGear(i, alt.name)) ? `a smaller ${alt.name}`
    : carried.some((i) => isGear(i, alt.name)) ? `${alt.name} at hand`
    : alt.name)
  return getUnmetCastRequirements(c, key).map((item) => item.map(label).join(' or ')).join(' · ')
}

// The conditions the spell is cast under, left to the table to judge.
export function getCastConditions(key: SpellKey): string {
  return requirementsLabel(SPELLS[key].castRequirements.filter((item) => item.some((alt) => alt.kind === 'condition')))
}

// A spell whose cost takes ETs is cast over that time, never within a
// round: the exploration loop casts it.
export function isCastOverETs(key: SpellKey): boolean {
  return SPELLS[key].cost.ET > 0
}

// "Spells require using a focus surge to be cast in combat scenes." — unless
// quickened. Before the combat has started (`charged`) there are no surges
// and nothing is paid.
export function canCastSpell(c: Character, key: SpellKey, quicken: boolean, charged: boolean): boolean {
  if (!isCastPossible(c, key)) return false
  const spell = SPELLS[key]
  if (!isCampaignCharacter(c) || !(quicken ? canAfford(c, spell.cost, charged) : canAffordOrHold(c, spell.cost, charged))) return false
  return !charged || quicken || c.usedSurge === 'focus'
}

// What the spell needs of the caster and the gear besides what it costs and
// the surge it is cast under: known, castable within a round, and its
// requirements met. What a spell held over to the next round still needs when
// it finishes (combat.tex "Concentration").
export function isCastPossible(c: Character, key: SpellKey): boolean {
  if (!isCampaignCharacter(c) || !(key in c.spells)) return false
  const spell = SPELLS[key]
  if (spell.DL === null || isCastOverETs(key)) return false
  return meetsCastRequirements(c, key) && hasChargeTarget(c, key) && mayCastWhileConcentrating(c, key)
}

// The DL side of a spell's test resolved for this caster. Terms the domain
// knows become a number; the rest ("morale aggravators", "poison DL") are
// handed back as words for the table to add.
export type ResolvedTest = {
  value: number | null // the sum of what resolved, null when nothing did
  extra: string // the unresolved terms, joined
  roll: string // what the defender rolls
}

function resolveTerm(c: Character, term: string): number | null {
  if (/^\d+$/.test(term)) return Number(term)
  const scaled = term.match(/^(\d+)xSM$/)
  if (scaled) return Number(scaled[1]) * getSM(c)
  switch (term.toLowerCase()) {
    case 'charisma': return getCharisma(c)
    case 'accuracy': return getAccuracy(c)
    case 'strike': return getStrike(c)
    case 'spi': return getSPI(c)
    default: return null
  }
}

export function resolveDL(c: Character, dl: string, roll: string): ResolvedTest {
  const terms = dl.split('+').map((t) => t.trim()).filter(Boolean)
  const resolved = terms.map((t) => [t, resolveTerm(c, t)] as const)
  const known = resolved.filter(([, v]) => v !== null).map(([, v]) => v as number)
  return {
    value: known.length ? known.reduce((a, b) => a + b, 0) : null,
    extra: resolved.filter(([, v]) => v === null).map(([t]) => t).join(' + '),
    roll,
  }
}

export function resolveTest(c: Character, key: SpellKey): ResolvedTest | null {
  const test = getSpellTest(key)
  return test ? resolveDL(c, test.dl, test.roll) : null
}

// What the spell leaves its target to test, as the book words it: the test
// its morale or test effect forces. `roll` is the target's skill and `plus`
// what the book adds to it; `enhance` is what one "Enhance Spell" adds to
// the DL.
type TargetTest = { dl: string; roll: string; plus: string[]; enhance: number }

export function getSpellTest(key: SpellKey): TargetTest | null {
  const { morale, forced } = SPELLS[key]
  const resist = (morale ?? forced)?.resist
  return resist ? { dl: resist.dl, roll: resist.roll, plus: resist.plus ? [resist.plus] : [], enhance: resist.enhance } : null
}

// The skill the spell's targets test with ("Charisma vs will"); null when it
// names none the sheet has.
export function getSpellTestRoll(key: SpellKey): keyof Skills | null {
  const roll = getSpellTest(key)?.roll ?? ''
  return roll in skillTermGetters ? roll as keyof Skills : null
}

// What the book adds to the target's side of the test, the caster's
// (spells.tex "Pacify": "will + Charisma"), or a number ("health + 2").
export function getSpellTestAddedTerms(caster: Character, key: SpellKey): Term[] {
  const test = getSpellTest(key)
  if (!test) return []
  return test.plus
    .map((label) => ({ label: /^\d+$/.test(label) ? label : `caster's ${label}`, value: resolveDL(caster, label, test.roll).value ?? 0 }))
}

// spells.tex "Effortless Spell": "The spell must spend the highest between
// the rest's AP cost and the spell's AP cost" — what resting adds to the AP
// the cast already spent.
export function getEffortlessCost(c: Character, spentAP: number): ActionCost {
  return { AP: Math.max(0, getActionCost(c, 'rest').AP - spentAP), STA: 0 }
}

// Whether the caster can pay for resting while casting: never into negative
// AP. Whether they can breathe to rest is the fight's to say.
export function canAffordRestWhileCasting(c: CampaignCharacter, spentAP: number, charged: boolean): boolean {
  return canAfford(c, getEffortlessCost(c, spentAP), charged)
}
