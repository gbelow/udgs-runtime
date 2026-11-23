import type { SceneState } from '../types'
import { isDead } from '../../character/rules/afflictions'
import { getActionDef } from './actionCatalog'
import { getAvailableActions } from './options'
import { getRoundPhase } from './roundChange'

// The round change's rest step, where whoever wants to rests or speaks. At a
// table with no GM to say when it is over, it waits for everyone who still
// may and has not said they are done (the user's ruling).

// Whether the character may still rest or speak in the step.
export function canStillRest(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && !isDead(c) && getRoundPhase(state) === 'rest' && getAvailableActions(state, id).some((o) => o.available && getActionDef(o.draft.kind).rest)
}

// Everyone who may still rest or speak and has not said they are done.
export function getRestAwaited(state: SceneState): string[] {
  if (getRoundPhase(state) !== 'rest') return []
  return Object.keys(state.characters).filter((id) => !state.doneResting.includes(id) && canStillRest(state, id))
}
