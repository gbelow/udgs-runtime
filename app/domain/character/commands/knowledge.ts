import { CharacterUpdater } from '../../types'
import { isSpecificKnowledgeName, knowledgeName } from '../rules/knowledge'

export function removeSpecificKnowledge(name: string): CharacterUpdater {
  return (character) => {
    const { [name]: _, ...remaining } = character.specificKnowledges
    return { ...character, specificKnowledges: remaining }
  }
}

// story.tex "Specific Knowledge": a new one starts at level 0. A name that is
// blank, already held, or a formal knowledge's is refused.
export function addSpecificKnowledge(name: string): CharacterUpdater {
  const named = knowledgeName(name)
  return (character) =>
    !isSpecificKnowledgeName(named) || Object.hasOwn(character.specificKnowledges, named)
      ? character
      : { ...character, specificKnowledges: { ...character.specificKnowledges, [named]: 0 } }
}
