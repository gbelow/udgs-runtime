import type { Attitude, AttitudeEvent, Character, Degree } from '../../types'
import { getConvictionLevel, getConvictionSlot, type ConvictionSlot } from './requirements'
import { getLearnedAbilities } from './effects'
import { ABILITY_FAMILIES, type FamilyKey } from '../../abilities'

// What happened to a character in play that an attitude may answer: a test
// they made (the skill's value, the DL, the degree), their limit stress
// action activated, an action they prepared crit, or a turn of theirs ended
// with nothing prepared and nothing held, or a round they spent enraged
// ended, with a combat surge made in it or not.
export type AttitudeHappening =
  | { event: 'test'; skill: 'will'; value: number; DL: number; degree: Degree }
  | { event: 'limitStress' }
  | { event: 'preparedCrit' }
  | { event: 'unpreparedTurn' }
  | { event: 'enragedRound'; combatSurge: boolean }

function matches(on: AttitudeEvent, happened: AttitudeHappening): boolean {
  switch (on.event) {
    case 'test':
      return happened.event === 'test' && happened.skill === on.skill
        && (on.degrees.length === 0 || on.degrees.includes(happened.degree))
        && happened.DL >= happened.value + on.DLOverSkill
    case 'enragedRound':
      return happened.event === 'enragedRound' && happened.combatSurge === on.combatSurge
    case 'limitStress':
    case 'preparedCrit':
    case 'unpreparedTurn':
      return happened.event === on.event
  }
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

// abilities.json "Cunning Studies": the abilities the XP of the conviction
// adopted on the slot may train, by the studies of the learned abilities.
export function getStudies(c: Character, slot: ConvictionSlot): FamilyKey[] {
  const conviction = c.trainables[slot].name
  if (getConvictionLevel(c, conviction) === null) return []
  const sections = new Set(getLearnedAbilities(c).flatMap((a) => a.studies).filter((s) => s.conviction === conviction).map((s) => s.section))
  return (Object.keys(ABILITY_FAMILIES) as FamilyKey[]).filter((f) => sections.has(ABILITY_FAMILIES[f].section))
}
