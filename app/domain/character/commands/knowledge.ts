import { Character, CharacterUpdater } from '../../types'
import { emptyKnowledge } from '../rules/knowledge'
import { knowledgesLens, makeKnowledgeEntryLens } from '../lenses/knowledge'

export function removeKnowledge(name: string): CharacterUpdater {
  return (character: Character) => {
    const { [name]: _, ...remainingKnowledges } = knowledgesLens.get(character)
    return knowledgesLens.set(character, remainingKnowledges)
  }
}

export function addKnowledge(name: string): CharacterUpdater {
  return (character: Character) => makeKnowledgeEntryLens(name).set(character, emptyKnowledge(name))
}
