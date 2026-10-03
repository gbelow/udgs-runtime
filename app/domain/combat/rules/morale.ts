import type { AfflictionKey, CampaignCharacter, Degree } from '../../types'
import type { CombatState, Pressure } from '../types'
import { MORALE_AGGRAVATORS, MORALE_TRIGGER, SOCIAL_BONUS } from '../../tables'
import { getAfflictions, getInjuryPenalty, isDead } from '../../character/rules/afflictions'
import { getCharisma } from '../../character/rules/characteristics'
import { getWill } from '../../character/rules/skills'
import { sumTerms, type Term } from '../../character/rules/terms'
import type { Test } from './test'
import { getFightName } from './fighters'
import { getSituationalAfflictions, isSuffocating } from './situational'

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

export function getPressure(state: CombatState, id: string): SocialPressure {
  const said = state.pressure.filter((p) => p.target === id && p.round === state.round - 1)
  return {
    hostile: highest(said.filter((p) => p.kind !== 'rally' && p.kind !== 'insult')),
    rally: highest(said.filter((p) => p.kind === 'rally')),
    insult: highest(said.filter((p) => p.kind === 'insult')),
  }
}

// combat.tex "Social actions": the value is "1 + character's charisma/2".
export function getSocialValue(c: CampaignCharacter): number {
  return SOCIAL_BONUS + Math.floor(getCharisma(c) / 2)
}

// combat.tex "Morale", "Combat morale DL = aggravating factors": what weighs
// on the character as the fight stands, read off their state and never stored.
// A rally is a term below zero.
export function getAggravators(state: CombatState, id: string): Term[] {
  const c = state.characters[id]
  if (!c) return []
  const { hostile, rally, insult } = getPressure(state, id)
  const afflictions = getAfflictions(c, getSituationalAfflictions(state, id))
  const terms: Term[] = []
  if (afflictions.includes('oblivious')) terms.push({ label: 'oblivious', value: MORALE_AGGRAVATORS.oblivious })
  else if (afflictions.includes('disoriented')) terms.push({ label: 'disoriented', value: MORALE_AGGRAVATORS.disoriented })
  const injury = getInjuryPenalty(c)
  if (injury > 0) terms.push({ label: 'injured', value: MORALE_AGGRAVATORS.injured * injury })
  if (c.injuries.burning > 0 || isSuffocating(state, c)) terms.push({ label: 'burning or suffocating', value: MORALE_AGGRAVATORS.burning })
  if (c.resources.STA <= 0) terms.push({ label: 'out of STA', value: MORALE_AGGRAVATORS.outOfSTA })
  if (hostile) terms.push({ label: hostile.kind, value: hostile.value })
  if (insult) terms.push({ label: 'insult', value: insult.value })
  if (rally) terms.push({ label: 'rally', value: -rally.value })
  return terms
}

export function getMoraleDL(state: CombatState, id: string): number {
  return Math.max(0, sumTerms(getAggravators(state, id)))
}

// combat.tex "Combat morale test": a will test against the DL, which "can be
// done normally, safely or riskily"; the die does not explode (the table's
// ruling).
export function getMoraleTest(state: CombatState, id: string): Test | null {
  const c = state.characters[id]
  return c ? { skill: getWill(c), DL: getMoraleDL(state, id), explodes: false, scale: 'degrees' } : null
}

const MORALE_AFFLICTIONS: readonly AfflictionKey[] = ['afraid', 'enraged', 'confused']

// combat.tex "Morale test triggers": "at the beginning of a round when
// aggravating factors are at 5 or more, when under specific afflictions" —
// afraid, enraged or confused. The dead and the unconscious make none.
export function getMoraleCalled(state: CombatState): string[] {
  return Object.keys(state.characters).filter((id) => {
    const c = state.characters[id]
    const afflictions = getAfflictions(c, getSituationalAfflictions(state, id))
    if (isDead(c) || afflictions.includes('unconscious')) return false
    const stressed = sumTerms(getAggravators(state, id).filter((t) => t.value > 0)) >= MORALE_TRIGGER
    return stressed || getPressure(state, id).hostile !== null || MORALE_AFFLICTIONS.some((key) => afflictions.includes(key))
  })
}

// Why the character cannot make their morale test now, or null.
export function getMoraleBar(state: CombatState, id: string): string | null {
  const call = state.morale.find((m) => m.id === id)
  if (!call || !state.characters[id]) return 'not called to a morale test'
  return call.roll ? 'already tested this round' : null
}

// Why a turn waits on the morale tests, or null.
export function getMoraleTurnBar(state: CombatState): string | null {
  const pending = state.morale.filter((call) => call.roll === null && state.characters[call.id]).map((call) => call.id)
  return pending.length > 0 ? `waiting for ${pending.map((id) => getFightName(state, id)).join(', ')} to test morale` : null
}

export type MoraleOutcome = { cure: AfflictionKey[]; inflict: AfflictionKey[]; limitStress: boolean }

// combat.tex "Morale": "A graze leaves the character afraid, and a miss
// activates the character's limit stress action", which "only triggers if
// there is an enemy within 30m" — and, the table's ruling, a miss leaves them
// afraid too. "Afraid" and "Enraged": the fear and the anger end "when the
// character succeeds on their Will test" — a graze is not success — and each
// ends by becoming the other. combat.tex "Taunt": a taunt causes "enraged
// instead of afraid".
export function getMoraleOutcome(degree: Degree, enemyNear: boolean, taunted: boolean): MoraleOutcome {
  if (degree === 'hit' || degree === 'critical') return { cure: [...MORALE_AFFLICTIONS], inflict: [], limitStress: false }
  const [inflict, cure]: AfflictionKey[] = taunted ? ['enraged', 'afraid'] : ['afraid', 'enraged']
  return { cure: [cure], inflict: [inflict], limitStress: degree === 'miss' && enemyNear }
}
