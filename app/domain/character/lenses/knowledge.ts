import { Character, Knowledges, Lens, Trainable, TrainableSchema } from '../../types'
import { getMentalAfflictionPenalty } from './afflictions'
import { composeLens, makeInvertingSetter, makePropLens } from './factories'

export function emptyKnowledge(name: string): Trainable {
  return TrainableSchema.parse({ name, type: 'knowledge' })
}

export const knowledgesLens: Lens<Character, Knowledges> = makePropLens<Character, 'knowledges'>('knowledges')

// Unlike makePropLens<Trainables, keyof Trainables>, this hop can't assume the
// key exists — `knowledges` starts at {} and only gains entries as they're
// set — so it defaults to an empty Trainable instead of reading `undefined`.
function knowledgeEntryLens(name: string): Lens<Knowledges, Trainable> {
  return {
    get: (knowledges) => knowledges[name] ?? emptyKnowledge(name),
    set: (knowledges, value) => ({ ...knowledges, [name]: value }),
  }
}

export function makeKnowledgeEntryLens(name: string): Lens<Character, Trainable> {
  return composeLens(knowledgesLens, knowledgeEntryLens(name))
}

// combat.tex "Afflictions": mental penalties affect "all Knowledges". The
// getter therefore reports the afflicted value, and the setter inverts through
// the penalty so writing a knowledge level still changes the stored base.
export function getKnowledge(name: string): (c: Character) => number {
  return (c: Character) => makeKnowledgeEntryLens(name).get(c).value - getMentalAfflictionPenalty(c)
}

// Every knowledge the character holds, resolved through its own getter so the
// mental-affliction penalty is already applied. A flat name -> value record: the
// shape a list of knowledges renders from, and the shape a per-entry lookup can
// read without reaching back for the character.
export function getKnowledgeValues(c: Character): Record<string, number> {
  return Object.fromEntries(
    Object.keys(knowledgesLens.get(c)).map((name) => [name, getKnowledge(name)(c)]),
  )
}

export function makeKnowledgeLens(name: string): Lens<Character, number> {
  const baseLens = composeLens(makeKnowledgeEntryLens(name), makePropLens<Trainable, 'value'>('value'))
  const getter = getKnowledge(name)
  return {
    get: getter,
    set: makeInvertingSetter(getter, baseLens.get, baseLens.set),
  }
}
