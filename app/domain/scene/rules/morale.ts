import { NOT_ENOUGH_AP } from '../../character/rules/cost'
import type { AfflictionKey, CampaignCharacter, Degree } from '../../types'
import type { SceneState, Pressure } from '../types'
import { MORALE_AGGRAVATORS, MORALE_ENEMY_RADIUS, MORALE_LOW_STA, MORALE_SENSE_RADIUS, MORALE_TRIGGER, SOCIAL_BONUS } from '../../tables'
import { getAfflictions, getInjuryPenalty, hasAffliction, isDead } from '../../character/rules/afflictions'
import { getCharisma } from '../../character/rules/characteristics'
import { getWill } from '../../character/rules/skills'
import { getConvictionLevel } from '../../character/rules/requirements'
import { sumTerms, type Term } from '../../character/rules/terms'
import { getDegree, type Test } from '../../play/test'
import { getBuffBonus, getGrantingAbility, getRollModes, hasGrant } from '../../character/rules/effects'
import { ABILITIES } from '../../abilities'
import type { RollMode } from '../../play/dice'
import { getFightName } from './fighters'
import { getSituationalAfflictions, isCollapsed } from './situational'
import { isNearBlindGround } from './detection'
import { isRunningInChase } from './chase'
import { isParked } from './parked'
import { getOwnEdgeTerms } from './cunning'
import { getDistanceBetween } from './board/board'

// combat.tex "Social actions": what was said to the character in the round
// before, "multiple intimidations and taunts don't stack. Only the highest
// one counts", and so for rallies. Earlier ones have lapsed, a rally with the
// morale phase it was said before. Of two equal, the first said counts. An
// insult (creating.tex "Limit Stress Actions", abusive) is neither: it adds to
// the DL and calls no test of its own.
export type SocialPressure = { hostile: Pressure | null; rally: Pressure | null; insult: Pressure | null }

function highest(pressures: Pressure[]): Pressure | null {
  return pressures.reduce<Pressure | null>((best, p) => (best === null || p.value > best.value ? p : best), null)
}

export function getPressure(state: SceneState, id: string): SocialPressure {
  const said = state.pressure.filter((p) => p.target === id && p.round === state.round - 1)
  return {
    hostile: highest(said.filter((p) => p.kind !== 'rally' && p.kind !== 'insult')),
    rally: highest(said.filter((p) => p.kind === 'rally')),
    insult: highest(said.filter((p) => p.kind === 'insult')),
  }
}

// abilities.tex "Domination": who weighed on the character's morale test with
// a social action, from a party other than theirs: every enemy whose
// intimidation or taunt was said to them in the round before, the one
// counted or not (the table's ruling).
export function getStressAuthors(state: SceneState, id: string): string[] {
  const said = state.pressure.filter((p) => p.target === id && p.round === state.round - 1 && (p.kind === 'intimidate' || p.kind === 'taunt'))
  return [...new Set(said.map((p) => p.from))].filter((from) => isEnemyOf(state, from, id))
}

// Whether `a` is in the fight in another party than `b`.
export function isEnemyOf(state: SceneState, a: string, b: string): boolean {
  return a !== b && !!state.characters[a] && getPressureKey(state, a) !== getPressureKey(state, b)
}

// combat.tex "Combat morale test": whether a living enemy is within
// MORALE_ENEMY_RADIUS metres of the character (a cell is a metre), measured
// on the board. Null where the board cannot tell: there is none, or the
// character or an enemy out of that reach is not placed on it.
export function getEnemyNear(state: SceneState, id: string): boolean | null {
  let unmeasured = false
  for (const other of Object.keys(state.characters)) {
    if (!isEnemyOf(state, other, id) || isDead(state.characters[other])) continue
    const apart = getDistanceBetween(state, id, other)
    if (apart === null) unmeasured = true
    else if (apart <= MORALE_ENEMY_RADIUS) return true
  }
  return unmeasured ? null : false
}

// combat.tex "Morale", "Simplifying": the table's pressure is one number per
// party; whoever is in none shares the key ''.
export function getPressureKey(state: SceneState, id: string): string {
  return state.partyOf[id] ?? ''
}

// combat.tex "Social actions": the value is "1 + character's charisma/2".
// abilities.tex "Brutality": an intimidation said enraged uses "the
// character's ferocity level instead of charisma", whichever is higher (the
// table's ruling).
export function getSocialValue(c: CampaignCharacter, say: Pressure['kind']): number {
  const brutal = say === 'intimidate' && hasGrant(c, 'brutality') && hasAffliction(c, 'enraged')
  const value = brutal ? Math.max(getCharisma(c), getConvictionLevel(c, 'Ferocity') ?? 0) : getCharisma(c)
  return SOCIAL_BONUS + Math.floor(value / 2)
}

// combat.tex "Morale", "Combat morale DL = 0 + aggravating factors": what
// weighs on the character as the fight stands, read off their state and
// never stored, and the pressure the table judges it puts on them. Immobile
// and grappled do not add up: the worse counts (the table's ruling). A rally
// is a term below zero.
export function getAggravators(state: SceneState, id: string): Term[] {
  const c = state.characters[id]
  if (!c) return []
  const { hostile, rally, insult } = getPressure(state, id)
  const situational = getSituationalAfflictions(state, id)
  const tablePressure = state.tablePressure[getPressureKey(state, id)] ?? 0
  const terms: Term[] = []
  const injury = getInjuryPenalty(c)
  if (injury > 0) terms.push({ label: 'injured', value: MORALE_AGGRAVATORS.injured * injury })
  if (hasAffliction(c, 'immobile', situational)) terms.push({ label: 'immobile', value: MORALE_AGGRAVATORS.immobile })
  else if (hasAffliction(c, 'grappled', situational)) terms.push({ label: 'grappled', value: MORALE_AGGRAVATORS.grappled })
  if (isNearBlindGround(state, id, MORALE_SENSE_RADIUS)) terms.push({ label: 'sensory limitation', value: MORALE_AGGRAVATORS.sensoryLimitation })
  if (hasAffliction(c, 'suffocating', situational)) terms.push({ label: 'suffocating', value: MORALE_AGGRAVATORS.suffocating })
  if (c.resources.STA < MORALE_LOW_STA) terms.push({ label: 'out of STA', value: MORALE_AGGRAVATORS.outOfSTA })
  if (tablePressure !== 0) terms.push({ label: 'pressure', value: tablePressure })
  if (hostile) terms.push({ label: hostile.kind, value: hostile.value })
  if (insult) terms.push({ label: 'insult', value: insult.value })
  if (rally) terms.push({ label: 'rally', value: -rally.value })
  return terms
}

// The DL the aggravating factors add up to.
export function getMoraleDLOf(aggravators: Term[]): number {
  return Math.max(0, sumTerms(aggravators))
}

export function getMoraleDL(state: SceneState, id: string): number {
  return getMoraleDLOf(getAggravators(state, id))
}

// What the aggravating factors weighing on the character come to, a rally
// left out: it lowers the DL, not what weighs on them.
export function getPressingFactors(state: SceneState, id: string): number {
  return sumTerms(getAggravators(state, id).filter((t) => t.value > 0))
}

// combat.tex "Combat morale test": a will test against the DL, which "can be
// done normally, safely or riskily"; the die does not explode (the table's
// ruling).
// play.tex "Safe and risky tests": "This mechanic can only be used when
// indicated in the skill or ability": the ways the character may throw their
// morale test, as their abilities allow for will.
export function getMoraleModes(c: CampaignCharacter): RollMode[] {
  return getRollModes(c, 'will', true)
}

// The morale test, the tester's will with their edges against the DL.
export function getMoraleTest(state: SceneState, id: string): Test | null {
  const c = state.characters[id]
  if (!c) return null
  const skill = [{ label: 'will', value: getWill(c) }, ...getOwnEdgeTerms(state, id)]
  return { skill: sumTerms(skill), DL: getMoraleDL(state, id), explodes: false, scale: 'degrees', terms: { skill, DL: getAggravators(state, id) } }
}

const MORALE_AFFLICTIONS: readonly AfflictionKey[] = ['afraid', 'enraged', 'confused']

// combat.tex "Morale test triggers": "at the beginning of a round when
// aggravating factors are at 3 or more, when under specific afflictions" —
// afraid, enraged or confused. The dead, the unconscious, the collapsed and
// the parked make none (combat.tex "Out of the fight"), and neither does
// anyone running in a chase: the test is combat's (the table's ruling).
export function getMoraleCalled(state: SceneState): string[] {
  return Object.keys(state.characters).filter((id) => {
    if (!canTestMorale(state, id)) return false
    const afflictions = getAfflictions(state.characters[id], getSituationalAfflictions(state, id))
    const stressed = getPressingFactors(state, id) >= MORALE_TRIGGER
    return stressed || getPressure(state, id).hostile !== null || MORALE_AFFLICTIONS.some((key) => afflictions.includes(key))
  })
}

function canTestMorale(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && !isDead(c) && !hasAffliction(c, 'unconscious', getSituationalAfflictions(state, id)) && !isCollapsed(state, c) && !isParked(state, id) && !isRunningInChase(state, id)
}

// abilities.json "Hype Up": "They can decide to do a morale test in the
// beginning of any round during combat": whoever has learned it and could
// make a morale test but is not called to one. One test a round: a character
// already called makes that one (the table's ruling).
export function getMoraleVolunteers(state: SceneState, called: readonly string[]): string[] {
  return Object.keys(state.characters).filter((id) => !called.includes(id) && hasGrant(state.characters[id], 'hypeUp') && canTestMorale(state, id))
}

// Why the character cannot pass up the morale test they chose whether to
// make, or null.
export function getSkipMoraleBar(state: SceneState, id: string): string | null {
  const call = state.morale.find((m) => m.id === id)
  if (!call || !call.optional) return 'not offered a morale test'
  return call.roll ? 'already tested this round' : null
}

// Why the character cannot make their morale test now, or null.
export function getMoraleBar(state: SceneState, id: string): string | null {
  const call = state.morale.find((m) => m.id === id)
  if (!call || !state.characters[id]) return 'not called to a morale test'
  if (isDead(state.characters[id])) return 'dead'
  return call.roll ? 'already tested this round' : null
}

// Why a turn waits on the morale tests, or null: a test not yet made, or
// made and left open for a reroll (abilities.tex "Fateful").
export function getMoraleTurnBar(state: SceneState): string | null {
  const pending = state.morale.filter((call) => (call.roll === null || call.roll.open) && state.characters[call.id] && !isDead(state.characters[call.id])).map((call) => call.id)
  return pending.length > 0 ? `waiting for ${pending.map((id) => getFightName(state, id)).join(', ')} to test morale` : null
}

export type MoraleOutcome = { cure: AfflictionKey[]; inflict: AfflictionKey[]; limitStress: boolean }

// combat.tex "Morale": "A graze leaves the character afraid, and a miss
// activates the character's limit stress action", which "only triggers if
// there is an enemy within 30m" — and, the table's ruling, a miss leaves them
// afraid too. "Afraid" and "Enraged": the fear and the anger end "when the
// character succeeds on their Will test" — a graze is not success — and each
// ends by becoming the other. combat.tex "Taunt": a taunt causes "enraged
// instead of afraid". The limit stress action is read off `compulsion`, the
// degree the test comes to against it (`getCompulsionDegree`).
// abilities.tex "Furious": the character "becomes enraged when they graze on
// a morale test, and only calm down on a crit"; a miss still leaves them
// afraid (the table's ruling).
// abilities.tex "Unshakable": "The character has no limit stress action": a
// miss leaves them afraid as a graze does, and activates nothing, from a
// morale test or a spell's (the table's ruling).
export function getMoraleOutcome(c: CampaignCharacter | undefined, degree: Degree, compulsion: Degree, enemyNear: boolean, taunted: boolean): MoraleOutcome {
  const furious = c !== undefined && hasGrant(c, 'furious')
  if (degree === 'critical') return { cure: [...MORALE_AFFLICTIONS], inflict: [], limitStress: false }
  if (degree === 'hit') return { cure: furious && hasAffliction(c, 'enraged') ? MORALE_AFFLICTIONS.filter((key) => key !== 'enraged') : [...MORALE_AFFLICTIONS], inflict: [], limitStress: false }
  const [inflict, cure]: AfflictionKey[] = taunted || (furious && degree === 'graze') ? ['enraged', 'afraid'] : ['afraid', 'enraged']
  const unshakable = c !== undefined && hasGrant(c, 'unshakable')
  return { cure: [cure], inflict: [inflict], limitStress: compulsion === 'miss' && enemyNear && !unshakable }
}

// abilities.tex "Fateful": "The character can spend 1 AP to reroll a will
// test once. The reroll must be taken": the morale test, thrown again the
// way it was, priced as the catalog prices Fateful. A test below a crit by
// one who has learned it and can pay is left open until they reroll it or
// keep it; null for one who has not learned it.
export function getFatefulAP(c: CampaignCharacter | undefined): number | null {
  const key = c ? getGrantingAbility(c, 'fateful') : null
  return key ? ABILITIES[key].cost.AP : null
}

export function isLeftOpen(c: CampaignCharacter | undefined, degree: Degree): boolean {
  const AP = getFatefulAP(c)
  return c !== undefined && AP !== null && degree !== 'critical' && c.resources.AP >= AP
}

// Why the character cannot reroll their morale test now, or null.
export function getFatefulBar(state: SceneState, id: string): string | null {
  const c = state.characters[id]
  const roll = state.morale.find((m) => m.id === id)?.roll
  const AP = getFatefulAP(c)
  if (!c || AP === null) return 'has not learned Fateful'
  if (!roll) return 'no morale test made'
  if (!roll.open) return roll.rerolled ? 'already rerolled' : 'the morale test is settled'
  return c.resources.AP < AP ? NOT_ENOUGH_AP : null
}

// Why the character cannot keep the morale test they left open, or null.
export function getKeepMoraleBar(state: SceneState, id: string): string | null {
  return state.morale.find((m) => m.id === id)?.roll?.open ? null : 'no morale test left open'
}

// abilities.tex "Hype up": "The character can enrage themselves on a hit or
// crit in a morale test", chosen once the test is seen (the table's
// ruling), while the round change is still at its morale tests. Why the
// character cannot now, or null.
export function getHypeUpBar(state: SceneState, id: string): string | null {
  const c = state.characters[id]
  const roll = state.morale.find((m) => m.id === id)?.roll
  if (!c || !hasGrant(c, 'hypeUp')) return 'has not learned Hype up'
  if (!roll) return 'no morale test made'
  if (roll.open) return 'the morale test is not settled'
  if (state.roundStep !== 'morale') return 'the morale tests are over'
  if (roll.degree !== 'hit' && roll.degree !== 'critical') return 'the morale test was not a hit'
  if (roll.hyped || hasAffliction(c, 'enraged')) return 'already enraged'
  return null
}

// combat.tex "Compulsions": a limit stress action is a compulsion.
// abilities.json "Contemplation": "Increases defense against any compulsions
// by 1": the morale test's score counts that much higher against the
// compulsion it would activate, and only against that (the table's ruling).
export function getCompulsionResistance(c: CampaignCharacter | undefined): number {
  return c ? getBuffBonus(c, 'resist:compulsion') : 0
}

export function getCompulsionDegree(c: CampaignCharacter | undefined, score: number, DL: number): Degree {
  return getDegree(score + getCompulsionResistance(c), DL)
}
