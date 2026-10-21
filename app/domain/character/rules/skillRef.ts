import type { Character, Degree, LearningTest, SkillRef } from '../../types'
import { DEGREES } from '../../types'
import type { Test } from '../../play/test'
import { skillTermGetters } from './skills'
import { getKnowledgeTestTerms, knowledgeName } from './knowledge'
import { sumTerms } from './terms'

// story.tex "Knowledge": a knowledge is tested at "2x Knowledge"; a skill at
// its value.
export function getSkillValue(ref: SkillRef): (c: Character) => number {
  return (c) => sumTerms(ref.kind === 'skill' ? skillTermGetters[ref.key](c) : getKnowledgeTestTerms(ref.name)(c))
}

export function getSkillTest(ref: SkillRef, DL: number): (c: Character) => Test {
  return (c) => ({ skill: getSkillValue(ref)(c), DL, explodes: false, scale: 'degrees' })
}

export function getSkillName(ref: SkillRef): string {
  return ref.kind === 'skill' ? ref.key : ref.name
}

// story.tex "Learning tests": the levels gained for the degree, by the order
// miss, graze, hit, crit.
export function getLearningGain(learning: LearningTest, degree: Degree): number {
  return learning.gains[DEGREES.indexOf(degree)]
}

// The level of the knowledge a learning test leaves the character at: what
// they hold, raised by the degree's gain up to the test's limit, never
// lowered.
export function getLearnedLevel(learning: LearningTest, degree: Degree): (c: Character) => { name: string; held: number; level: number } {
  return (c) => {
    const name = knowledgeName(learning.knowledge)
    const held = c.specificKnowledges[name] ?? 0
    return { name, held, level: Math.max(held, Math.min(learning.max, held + getLearningGain(learning, degree))) }
  }
}
