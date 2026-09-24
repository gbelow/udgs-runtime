import type { CampaignCharacter } from '../../types'
import type { CombatState } from '../types'
import { dropItem } from '../../item/commands/hands'
import { getHeldItem } from '../../item/rules/hands'
import { onFloor } from '../rules/floor'
import { settleGrapples } from './grapple'
import { amendAction, declareAction } from './action'
import { getOpenAction } from '../rules/action'

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

// An item on the floor chosen for picking up: declares the pick up with it,
// or, while the character's pick up is still being declared, changes it.
export function pickFloorItem(characterId: string, itemId: string, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (open?.kind === 'pickUp' && open.actorId === characterId) return amendAction({ itemId })(state)
    return declareAction(characterId, { kind: 'pickUp', itemId }, newId)(state)
  }
}
