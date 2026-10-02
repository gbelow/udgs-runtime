import type { Updater } from '../types'
import { dropItem, throwOffShield } from '../../item/commands/hands'
import { getHeldItem } from '../../item/rules/hands'
import { getSeveredItem } from '../../character/rules/body'
import type { CombatState } from '../types'
import type { Character, Item } from '../../types'
import { onFloor } from '../rules/floor'
import { settleBinds } from './bind'
import { amendAction, declareAction } from './action'
import { getOpenAction } from '../rules/log'
import { isSpendingOutOfTurn } from '../rules/turn'

// What a character lets go of lands where they stand, and a holder who let
// go of the last thing they could grapple with lets go of the grapple. A
// move refused leaves the character as it was, and nothing lands.
function landOnFloor(characterId: string, item: Item | null | undefined, letGo: <C extends Character>(c: C) => C): Updater {
  return (state) => {
    const c = state.characters[characterId]
    if (!c || !item) return state
    const after = letGo(c)
    if (after === c || isSpendingOutOfTurn(state, c, after)) return state
    return settleBinds({
      ...state,
      characters: { ...state.characters, [characterId]: after },
      floor: [...state.floor, onFloor(item, state.board?.placements[characterId]?.cell ?? null)],
    })
  }
}

// combat.tex "Putting items away": "Dropping items on the floor costs 0 AP".
export function dropToFloor(characterId: string, itemId: string): Updater {
  return (state) => {
    const c = state.characters[characterId]
    return landOnFloor(characterId, c && getHeldItem(c, itemId), dropItem(itemId))(state)
  }
}

// gear.tex "Shields": the shield thrown off the back, once the standard
// action is paid.
export function throwOffShieldToFloor(characterId: string): Updater {
  return (state) => landOnFloor(characterId, state.characters[characterId]?.onBack, throwOffShield())(state)
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
