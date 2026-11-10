import { TrainablesSchema, type Attitude, type AttitudeEvent, type Character, type Degree, type Skills, type Trainables } from '../../types'
import { getConvictionLevel, getConvictionSlot, type ConvictionSlot } from './requirements'
import { getLearnedAbilities } from './effects'
import { ABILITY_FAMILIES, type FamilyKey } from '../../abilities'
import { getTalentReliefRate, getTrainableRaisePrice } from './learning'
import { getAbilityReliefRate } from './abilities'
import { getD10Face, type RollMode } from '../../play/dice'
import { getCallResult, type DieCall } from '../../play/calls'

// What happened to a character in play that an attitude may answer: a test
// they made scored (the skill, where it is known, and its value, the DL, the
// degree, the way it was thrown), a die they threw for a test (the way, the face the
// kept d10 showed), their limit stress action activated, an action they
// prepared crit, a turn of theirs ended with nothing prepared and nothing
// held, or a round they spent enraged ended.
export type AttitudeHappening =
  | { event: 'test'; skill: keyof Skills | null; value: number; DL: number; degree: Degree; mode: RollMode }
  | { event: 'die'; mode: RollMode; face: number }
  | { event: 'limitStress' }
  | { event: 'preparedCrit' }
  | { event: 'unpreparedTurn' }
  | { event: 'enragedRound'; combatSurge: boolean }

const among = <T,>(listed: readonly T[], value: T): boolean => listed.length === 0 || listed.includes(value)

function matches(on: AttitudeEvent, happened: AttitudeHappening): boolean {
  switch (on.event) {
    case 'test':
      return happened.event === 'test' && (on.skill === 'any' || happened.skill === on.skill)
        && among(on.modes, happened.mode) && among(on.degrees, happened.degree)
        && (on.DLOverSkill === null || happened.DL >= happened.value + on.DLOverSkill)
    case 'die':
      return happened.event === 'die' && among(on.modes, happened.mode) && among(on.faces, happened.face)
    case 'enragedRound':
      return happened.event === 'enragedRound' && happened.combatSurge === on.combatSurge
    case 'limitStress':
    case 'preparedCrit':
    case 'unpreparedTurn':
      return happened.event === on.event
  }
}

// A die thrown for a test: what it showed, and, where it was scored against
// a DL as it was thrown, what the test came to.
export type ThrownTest = { mode: RollMode; die: number; explodes: boolean; scored: { skill: keyof Skills | null; value: number; DL: number; degree: Degree } | null }

export function getThrowHappenings({ mode, die, explodes, scored }: ThrownTest): AttitudeHappening[] {
  return [{ event: 'die', mode, face: getD10Face(die, explodes) }, ...(scored ? [{ event: 'test' as const, mode, ...scored }] : [])]
}

// What an answered call leaves its roller: the die, and the test it was
// scored as, if it was one. A bare die is scored later, by what reads it.
export function getCallHappenings(call: DieCall): AttitudeHappening[] {
  if (call.die === null) return []
  const result = getCallResult(call)
  const scored = result && call.test ? { skill: null, value: call.test.skill, DL: call.test.DL, degree: result.degree } : null
  return getThrowHappenings({ mode: call.mode, die: call.die, explodes: call.explodes, scored })
}

// abilities.tex "Promoted Attitudes", "Prohibited Attitudes": the XP each
// conviction the character has adopted gains or loses for what happened, by
// the attitudes of their learned abilities. Where several promoted attitudes
// of one conviction answer the same thing, only the largest pays ("Fatalism":
// "1XP [...] or 2XP if the DL is 3 or more higher"); likewise the prohibited.
export function getAttitudeXP(c: Character, happened: AttitudeHappening): { slot: ConvictionSlot; XP: number }[] {
  const met = getLearnedAbilities(c).flatMap((a) => a.attitudes).filter((a) => matches(a.on, happened) && getConvictionLevel(c, a.conviction) !== null)
  const convictions = [...new Set(met.map((a) => a.conviction))]
  return convictions.flatMap((name) => {
    const slot = getConvictionSlot(name)
    const own = met.filter((a: Attitude) => a.conviction === name).map((a) => a.XP)
    const XP = Math.max(0, ...own) + Math.min(0, ...own)
    return slot && XP !== 0 ? [{ slot, XP }] : []
  })
}

// Something a conviction's XP may train, and how far each XP goes on it.
export type StudyTarget = { kind: 'trainable'; key: keyof Trainables } | { kind: 'ability'; family: FamilyKey }
export type StudyOffer = { target: StudyTarget; name: string; rate: number }

const TRAINABLE_KEYS = Object.keys(TrainablesSchema.shape) as (keyof Trainables)[]
const FAMILY_KEYS = Object.keys(ABILITY_FAMILIES) as FamilyKey[]

// A name for the target that tells it from any other.
export const getStudyKey = (t: StudyTarget): string => (t.kind === 'trainable' ? `trainable:${t.key}` : `ability:${t.family}`)

// What the XP of the conviction adopted on the slot may train, by the
// studies of the learned abilities: the abilities of a section, one XP for
// one (abilities.json "Cunning Studies"), or anything trained with XP but
// the conviction itself, priced with the talent the study raises
// (abilities.tex "Adaptive Learning": "as any type of XP considering the
// character's talent +1"). Where several studies offer the same thing, the
// one it goes furthest on.
export function getStudyOffers(c: Character, slot: ConvictionSlot): StudyOffer[] {
  const conviction = c.trainables[slot].name
  if (getConvictionLevel(c, conviction) === null) return []
  const studies = getLearnedAbilities(c).flatMap((a) => a.studies).filter((s) => s.conviction === conviction)
  const offers = studies.flatMap((study): StudyOffer[] => {
    if (study.kind === 'section') {
      return FAMILY_KEYS.filter((f) => ABILITY_FAMILIES[f].section === study.section).map((family) => ({ target: { kind: 'ability', family }, name: ABILITY_FAMILIES[family].family, rate: 1 }))
    }
    const trainables = TRAINABLE_KEYS.filter((key) => key !== slot && getTrainableRaisePrice(key)(c)?.currency === 'XP')
      .map((key): StudyOffer => ({ target: { kind: 'trainable', key }, name: c.trainables[key].name, rate: getTalentReliefRate(key, study.talent)(c) }))
    const abilities = FAMILY_KEYS.flatMap((family): StudyOffer[] => {
      const rate = getAbilityReliefRate(family, study.talent)(c)
      return rate === null ? [] : [{ target: { kind: 'ability', family }, name: ABILITY_FAMILIES[family].family, rate }]
    })
    return [...trainables, ...abilities]
  })
  const best = new Map<string, StudyOffer>()
  for (const offer of offers) {
    const held = best.get(getStudyKey(offer.target))
    if (!held || offer.rate > held.rate) best.set(getStudyKey(offer.target), offer)
  }
  return [...best.values()]
}

// The offer of the conviction's XP for the target, null where it may not
// train it.
export function getStudyOffer(c: Character, slot: ConvictionSlot, target: StudyTarget): StudyOffer | null {
  return getStudyOffers(c, slot).find((o) => getStudyKey(o.target) === getStudyKey(target)) ?? null
}
