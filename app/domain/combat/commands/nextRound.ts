import { CampaignCharacter } from '../../types'
import { payUpkeep } from '../../character/commands/abilities'
import { CombatState } from '../types'

// clear the used surge of all characters.
// add +6 AP to all characters but do not allow higher than 6
// increase round counter
export function nextRound(
  state: CombatState
): CombatState {
  const updatedCharacters: Record<string, CampaignCharacter> = {}

  for (const [id, character] of Object.entries(state.characters)) {
    // Abilities held on through the round are paid for now
    let updatedCharacter = payUpkeep(character)

    // Clear the surge used last round
    updatedCharacter = {
      ...updatedCharacter,
      usedSurge: null
    }

    // Add +6 AP but cap at 6
    if (updatedCharacter.resources) {
      const newAP = Math.min(8, updatedCharacter.resources.AP + 8)
      updatedCharacter = {
        ...updatedCharacter,
        resources: {
          ...updatedCharacter.resources,
          AP: newAP
        }
      }
    }

    updatedCharacters[id] = updatedCharacter
  }

  return ({
    ...state,
    characters: updatedCharacters,
    round: state.round + 1
  })
}
