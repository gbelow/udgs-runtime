import type { Action, CombatState } from '../types'
import { touchFire } from '../../character/commands/deliver'
import { getHazardAt, getHazardOf, getWalkedFootprints } from '../rules/hazard'
import { getTurnHolder } from '../rules/turn'
import { findOpenRoot } from '../rules/log'

// combat.tex "Fire": "The fire damage taken at the end of the turn is the
// worst environmental fire the character has touched during their turn" —
// only in their own turn, so what moves them outside it touches nothing.
// Once an action lands, the holder of the turn has touched what they stand
// in now — unless a move of their own is still being played out, which has
// them only part of the way — and, for a move of their own, every cell it
// walked through. A jump opening the turn so clears the fire they started
// in (combat.tex "Fire": "they can jump once to attempt to avoid its
// effects"), even when an opportunity attack lands before it.
export function touchFireInTurn(state: CombatState, action: Action): CombatState {
  const holder = getTurnHolder(state)
  const c = holder ? state.characters[holder] : undefined
  if (!holder || !c) return state
  const moving = findOpenRoot(state, 'move', (m) => m.actorId === holder) !== null
  const walked = action.kind === 'move' && action.actorId === holder ? getWalkedFootprints(state, action) : []
  const fire = Math.max(moving ? 0 : getHazardOf(state, holder).fire, ...walked.map((f) => getHazardAt(state, f).fire))
  const touched = touchFire(fire)(c)
  return touched === c ? state : { ...state, characters: { ...state.characters, [holder]: touched } }
}
