import knowledgeCatalog from '../../../assets/knowledges.json'
import { Character, Knowledges, KnowledgesSchema } from '../../types'
import { getMentalAfflictionPenalty } from './afflictions'
import { Term, sumTerms } from './terms'

// creating.tex "Areas of Knowledge": a formal knowledge is a trainable; any
// other name is a specific knowledge (story.tex "Specific Knowledge").
export function isFormalKnowledge(name: string): name is keyof Knowledges {
  return Object.hasOwn(KnowledgesSchema.shape, name)
}

// A knowledge's name as it is kept: trimmed and lowercased, so names that
// differ only in spacing or case are one knowledge, and a formal knowledge's
// name matches its key.
export function knowledgeName(name: string): string {
  return name.trim().toLowerCase()
}

// Whether a name can be a specific knowledge's: not blank, and not a formal
// knowledge's.
export function isSpecificKnowledgeName(name: string): boolean {
  const named = knowledgeName(name)
  return named !== '' && !isFormalKnowledge(named)
}

// The level held, formal or specific; a specific knowledge not held is 0.
function getKnowledgeLevel(c: Character, name: string): number {
  const named = knowledgeName(name)
  return isFormalKnowledge(named) ? c.trainables[named].value : (c.specificKnowledges[named] ?? 0)
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
// story.tex "Knowledge": "Use 2x the relevant knowledge ... as the skill
// value" — the terms of a test of the knowledge.
export function getKnowledgeTestTerms(name: string): (c: Character) => Term[] {
  const terms = getKnowledgeTerms(name)
  return (c: Character) => terms(c).map((t) => ({ ...t, value: 2 * t.value }))
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

// The specific knowledges a learning test can name: the ones held, then the
// catalog's others, each by the name a character holds it under.
export function getLearnableKnowledges(c: Character): string[] {
  return [...new Set([...Object.keys(c.specificKnowledges), ...Object.keys(knowledgeCatalog)])]
}
