import { CampaignCharacter } from '../../types'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { applyTrigger } from '../../character/commands/effects'
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
    // Everything due at the round change lands now — the upkeep of what is
    // held on or was fired this round — and so does not being able to
    // breathe; a fired ability is then spent
    let updatedCharacter = suffocate(expireUsedAbilities(applyTrigger('end_round')(character)))

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
