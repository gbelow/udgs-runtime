import type { Attitude, AttitudeEvent, Character, Degree } from '../../types'
import { getConvictionLevel, getConvictionSlot, type ConvictionSlot } from './requirements'
import { getLearnedAbilities } from './effects'

// What happened to a character in play that an attitude may answer: a test
// they made (the skill's value, the DL, the degree), or their limit stress
// action activated.
export type AttitudeHappening =
  | { event: 'test'; skill: 'will'; value: number; DL: number; degree: Degree }
  | { event: 'limitStress' }

function matches(on: AttitudeEvent, happened: AttitudeHappening): boolean {
  switch (on.event) {
    case 'test':
      return happened.event === 'test' && happened.skill === on.skill
        && (on.degrees.length === 0 || on.degrees.includes(happened.degree))
        && happened.DL >= happened.value + on.DLOverSkill
    case 'limitStress':
      return happened.event === 'limitStress'
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
