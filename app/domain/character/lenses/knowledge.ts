import { Character, Knowledges, Lens, Trainable } from '../../types'
import { knowledges_list } from '../../lists'
import { composeLens, makeInvertingSetter, makePropLens } from './factories'
import { emptyKnowledge, getKnowledge } from '../rules/knowledge'

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

export function makeKnowledgeLens(name: string): Lens<Character, number> {
  const baseLens = composeLens(makeKnowledgeEntryLens(name), makePropLens<Trainable, 'value'>('value'))
  const getter = getKnowledge(name)
  return {
    get: getter,
    set: makeInvertingSetter(getter, baseLens.get, baseLens.set),
  }
}

// The formal areas the character has not trained yet — what an "add knowledge"
// picker can still offer. Custom names are always allowed, so this is the
// default list minus what is already held, not a closed set.
export function getAvailableKnowledges(c: Character): string[] {
  const held = knowledgesLens.get(c)
  return knowledges_list.filter((name) => !(name in held))
}
