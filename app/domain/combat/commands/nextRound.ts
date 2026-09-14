import { CampaignCharacter } from '../../types'
import { payUpkeep } from '../../character/commands/abilities'
import { suffocate } from '../../character/commands/bleed'
import { CombatState } from '../types'

// clear the used surge of all characters.
// add +6 AP to all characters but do not allow higher than 6
// increase round counter
export function nextRound(
  state: CombatState
): CombatState {
  const updatedCharacters: Record<string, CampaignCharacter> = {}

  for (const [id, character] of Object.entries(state.characters)) {
    // Abilities held on through the round are paid for now, and so is not
    // being able to breathe
    let updatedCharacter = suffocate(payUpkeep(character))

    // Clear the surge used last round and the roll left unresolved in it
    updatedCharacter = {
      ...updatedCharacter,
      usedSurge: null,
      pendingAction: null,
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
