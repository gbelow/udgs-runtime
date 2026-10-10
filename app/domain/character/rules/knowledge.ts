import { Character, Knowledges, KnowledgesSchema } from '../../types'
import { getMentalAfflictionPenalty } from './afflictions'
import { Term, sumTerms } from './terms'

// creating.tex "Areas of Knowledge": a formal knowledge is a trainable; any
// other name is a specific knowledge (story.tex "Specific Knowledge").
export function isFormalKnowledge(name: string): name is keyof Knowledges {
  return Object.hasOwn(KnowledgesSchema.shape, name)
}

// The level held, formal or specific; a specific knowledge not held is 0.
function getKnowledgeLevel(c: Character, name: string): number {
  return isFormalKnowledge(name) ? c.trainables[name].value : (c.specificKnowledges[name] ?? 0)
}

// combat.tex "Afflictions": mental penalties affect "all Knowledges", formal
// and specific alike. The getter therefore reports the afflicted value, and
// the setter inverts through the penalty so writing a knowledge level still
// changes the stored base.
export function getKnowledgeTerms(name: string): (c: Character) => Term[] {
  return (c: Character) => [
    { label: name, value: getKnowledgeLevel(c, name) },
    { label: 'affliction', value: -getMentalAfflictionPenalty(c) },
  ]
}
export function getKnowledge(name: string): (c: Character) => number {
  const terms = getKnowledgeTerms(name)
  return (c: Character) => sumTerms(terms(c))
}

// Every specific knowledge the character holds, resolved through its own
// getter so the mental-affliction penalty is already applied.
export function getSpecificKnowledgeValues(c: Character): Record<string, number> {
  return Object.fromEntries(
    Object.keys(c.specificKnowledges).map((name) => [name, getKnowledge(name)(c)]),
  )
}
