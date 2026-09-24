import type { CampaignCharacter } from '../../types'
import type { CombatState } from '../types'
import { dropItem } from '../../item/commands/hands'
import { getHeldItem } from '../../item/rules/hands'
import { onFloor } from '../rules/floor'
import { settleGrapples } from './grapple'

type Updater = (state: CombatState) => CombatState

// combat.tex "Putting items away": "Dropping items on the floor costs 0 AP"
// — in a fight, the stack lands where the character stands, and a holder
// who dropped the last thing they could grapple with lets go.
export function dropToFloor(characterId: string, itemId: string): Updater {
  return (state) => {
    const c = state.characters[characterId]
    const item = c ? getHeldItem(c, itemId) : undefined
    if (!c || !item) return state
    const dropped = {
      ...state,
      characters: { ...state.characters, [characterId]: dropItem(itemId)(c) as CampaignCharacter },
      floor: [...state.floor, onFloor(item, state.board?.placements[characterId]?.cell ?? null)],
    }
    return settleGrapples(state.grapples)(dropped)
  }
}
