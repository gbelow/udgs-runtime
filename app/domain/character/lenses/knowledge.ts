import { Character, Lens, SpecificKnowledges } from '../../types'
import { makeInvertingSetter, makePropLens } from './factories'
import { getKnowledge } from '../rules/knowledge'

export const specificKnowledgesLens: Lens<Character, SpecificKnowledges> = makePropLens<Character, 'specificKnowledges'>('specificKnowledges')

// A specific knowledge's level, read through the affliction and inverted
// through it on write, so the stored level changes. A name not held reads 0.
export function makeSpecificKnowledgeLens(name: string): Lens<Character, number> {
  const getter = getKnowledge(name)
  return {
    get: getter,
    set: makeInvertingSetter(
      getter,
      (c: Character) => c.specificKnowledges[name] ?? 0,
      (c: Character, level: number) => ({ ...c, specificKnowledges: { ...c.specificKnowledges, [name]: level } }),
    ),
  }
}

