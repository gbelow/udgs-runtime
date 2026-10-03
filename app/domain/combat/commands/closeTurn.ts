import type { CombatState } from '../types'
import { endSurge } from '../../character/commands/actionSurge'
import { burnScorch, touchFire } from '../../character/commands/deliver'
import { getHazardOf } from '../rules/hazard'
import { updateCharacter } from './characters'

// The holder's turn is over. The AP a movement or combat surge left unspent
// goes with it (combat.tex "Action surge": "Ending the turn loses the surge
// AP"), and so does the movement surge's free running; the worst fire
// touched in it, where they stand now among it, burns (combat.tex "Fire").
// Nobody holds the turn after it.
export function closeTurn(state: CombatState, holder: string): CombatState {
  const fire = getHazardOf(state, holder).fire
  const ended = { ...state, inTurnCharacter: '', fleeing: false, forcedSurge: '', contenders: [] }
  return updateCharacter(holder, (c) => ({ ...burnScorch(touchFire(fire)(endSurge(c))), runsFree: false }))(ended)
}
