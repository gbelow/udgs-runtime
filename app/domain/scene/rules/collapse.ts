import type { SceneState } from '../types'
import { getInjuryCapacity, isDead } from '../../character/rules/afflictions'
import { getRoundPhase } from './roundChange'
import { isParked } from './parked'
import { isCollapsed } from './situational'

// combat.tex "Tend Wounds": "A character can collapse themselves to trigger
// this. They can do it to themselves at the start of a round, before
// bleeding": in the round change's rest step, which the bleed follows.
function getChoiceBar(state: SceneState, id: string): string | null {
  const c = state.characters[id]
  if (!c || isDead(c) || isParked(state, id)) return 'not in the fight'
  return getRoundPhase(state) === 'rest' ? null : 'only as the round begins'
}

// Why the character cannot collapse themselves now, or null.
export function getLieDownBar(state: SceneState, id: string): string | null {
  const bar = getChoiceBar(state, id)
  if (bar) return bar
  return isCollapsed(state, state.characters[id]) ? 'already collapsed' : null
}

// Why the character cannot stand back up now, or null: "They can uncollapse
// themselves at the same moment", from a collapse of their own choosing; one
// at their injury capacity stays down.
export function getGetUpBar(state: SceneState, id: string): string | null {
  const bar = getChoiceBar(state, id)
  if (bar) return bar
  const c = state.characters[id]
  if (!c.injuries.collapsedByChoice) return 'not collapsed by choice'
  return c.injuries.injuryLevel >= getInjuryCapacity(c) ? 'collapsed by injuries' : null
}
