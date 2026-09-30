import type { Updater } from '../types'
import { dropItem } from '../../item/commands/hands'
import { getHeldItem } from '../../item/rules/hands'
import { getSeveredItem } from '../../character/rules/body'
import type { CombatState } from '../types'
import { onFloor } from '../rules/floor'
import { settleGrapples } from './grapple'
import { amendAction, declareAction } from './action'
import { getOpenAction } from '../rules/log'

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
      characters: { ...state.characters, [characterId]: dropItem(itemId)(c) },
      floor: [...state.floor, onFloor(item, state.board?.placements[characterId]?.cell ?? null)],
    }
    return settleGrapples(dropped)
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

// combat.tex "Throw": the item chosen to throw — a held one, or one already
// on the floor — declares the throw, or changes it while it is still being
// declared; where it lands is picked on the board (`pickCell`).
export function pickThrowItem(characterId: string, itemId: string, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (open?.kind === 'throw' && open.actorId === characterId) return amendAction({ itemId })(state)
    return declareAction(characterId, { kind: 'throw', itemId }, newId)(state)
  }
}

// combat.tex "Wounds": a part cut off falls where its owner stands, and so
// does what it was holding when no other hand still has it. Read off what the
// fight was before the action landed and what it came to; the severed part
// is named after the action that took it.
export function settleSevered(before: CombatState, actionId: string): Updater {
  return (state) => {
    const fallen = Object.values(state.characters).flatMap((c) => {
      const was = before.characters[c.id]
      if (!was) return []
      const cell = state.board?.placements[c.id]?.cell ?? null
      return was.body
        .filter((part) => !part.lost && c.body.some((p) => p.id === part.id && p.lost))
        .flatMap((part) => {
          const held = part.itemId && !c.held.some((i) => i.id === part.itemId) ? getHeldItem(was, part.itemId) : undefined
          const limb = getSeveredItem(part, `severed:${actionId}:${c.id}:${part.id}`)
          return [onFloor(limb, cell), ...(held ? [onFloor(held, cell)] : [])]
        })
    })
    return fallen.length === 0 ? state : { ...state, floor: [...state.floor, ...fallen] }
  }
}
