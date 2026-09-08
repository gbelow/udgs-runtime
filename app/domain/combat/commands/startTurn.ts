import { getActiveCharacter } from '../lenses/activeCharacter'
import { CombatState } from '../types'

export function startTurn(
  state: CombatState,
): CombatState {
  const character = getActiveCharacter(state)
  return(
    {...state, inTurnCharacter: character?.id ?? ''}
  )
}
