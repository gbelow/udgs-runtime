import { Character, Trainable, TrainableSchema } from '../../types'
import { getMentalAfflictionPenalty } from './afflictions'
import { Term, sumTerms } from './terms'

export function emptyKnowledge(name: string): Trainable {
  return TrainableSchema.parse({ name, type: 'knowledge' })
}

// `knowledges` starts at {} and only gains entries as they're set, so a name
// not yet held reads as an empty Trainable instead of `undefined`.
function getKnowledgeEntry(c: Character, name: string): Trainable {
  return c.knowledges[name] ?? emptyKnowledge(name)
}

// combat.tex "Afflictions": mental penalties affect "all Knowledges". The
// getter therefore reports the afflicted value, and the setter inverts through
// the penalty so writing a knowledge level still changes the stored base.
export function getKnowledgeTerms(name: string): (c: Character) => Term[] {
  return (c: Character) => [
    { label: name, value: getKnowledgeEntry(c, name).value },
    { label: 'affliction', value: -getMentalAfflictionPenalty(c) },
  ]
}
export function getKnowledge(name: string): (c: Character) => number {
  const terms = getKnowledgeTerms(name)
  return (c: Character) => sumTerms(terms(c))
}

// Every knowledge the character holds, resolved through its own getter so the
// mental-affliction penalty is already applied. A flat name -> value record: the
// shape a list of knowledges renders from, and the shape a per-entry lookup can
// read without reaching back for the character.
export function getKnowledgeValues(c: Character): Record<string, number> {
  return Object.fromEntries(
    Object.keys(c.knowledges).map((name) => [name, getKnowledge(name)(c)]),
  )
}
