import { CampaignCharacter } from '../../types'
import { expireUsedAbilities } from '../../character/commands/abilities'
import { applyTrigger } from '../../character/commands/effects'
import { suffocate, bleed } from '../../character/commands/bleed'
import { isDead } from '../../character/rules/afflictions'
import { CombatState } from '../types'
import { getPlacedFootprint } from '../rules/board'
import { coordKey } from '../geometry'

// combat.tex "Gas": "anyone that starts the round inside a suffocating gas
// is suffocating by default" — and out of it, no longer for that reason.
// Nothing on a fight with no board, or for anyone not placed on it.
function breathe(state: CombatState, c: CampaignCharacter): CampaignCharacter {
  const footprint = getPlacedFootprint(state, c.id)
  if (!state.board || !footprint) return c
  const inGas = footprint.some((cell) => state.board?.terrain[coordKey(cell)]?.suffocating)
  const held = c.afflictions.includes('suffocating')
  if (inGas === held) return c
  return { ...c, afflictions: inGas ? [...c.afflictions, 'suffocating'] : c.afflictions.filter((a) => a !== 'suffocating') }
}

// clear the used surge of all characters.
// add +6 AP to all characters but do not allow higher than 6
// increase round counter
export function nextRound(
  state: CombatState
): CombatState {
  const updatedCharacters: Record<string, CampaignCharacter> = {}

  for (const [id, character] of Object.entries(state.characters)) {
    // A dead character has nothing left to pay or bleed out further — no
    // upkeep, no gas, no bleed clock still running on a corpse.
    if (isDead(character)) {
      updatedCharacters[id] = character
      continue
    }

    // Everything due at the round change lands now — the upkeep of what is
    // held on or was fired this round — and so does not being able to
    // breathe; a fired ability is then spent. combat.tex "Bleed": +1 IL per
    // bleed intensity at the end of every round in combat.
    let updatedCharacter = bleed(1)(suffocate(expireUsedAbilities(applyTrigger('end_round')(breathe(state, character)))))

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
