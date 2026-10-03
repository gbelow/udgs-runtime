import type { SocialAction } from '../../tables'
import type { CombatState } from '../types'
import { getAfflictions } from '../../character/rules/afflictions'
import { canAffordRest } from '../../character/rules/rest'
import { getOpenAction } from './log'
import { getSituationalAfflictions } from './situational'

// Who a social action is said to: others in the fight, once each. combat.tex
// "Taunt": a taunt "triggers a morale test for one enemy".
export function getSocialTargets(state: CombatState, id: string, kind: SocialAction, targets: string[]): string[] {
  const said = targets.filter((t, i) => t !== id && state.characters[t] && targets.indexOf(t) === i)
  return kind === 'taunt' ? said.slice(0, 1) : said
}

// combat.tex "Social actions": "Every social action costs 5 AP and counts as
// a Rest action, which can be done at the end of the round". Why the character
// cannot take one now, or null: like a rest, in or out of their turn and
// allowed to overdraw AP, with nothing being played out.
export function getSocialBar(state: CombatState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not in the fight'
  if (getOpenAction(state)) return 'an action is being played out'
  return canAffordRest(c, 'socialAction') ? null : 'not enough AP'
}

export function getSayBar(state: CombatState, id: string, kind: SocialAction, targets: string[]): string | null {
  return getSocialBar(state, id) ?? (getSocialTargets(state, id, kind, targets).length === 0 ? 'nobody to say it to' : null)
}

// combat.tex "Surrender": the flag is raised once.
export function getSurrenderBar(state: CombatState, id: string): string | null {
  return getSocialBar(state, id) ?? (state.surrendered.includes(id) ? 'already surrendered' : null)
}

// combat.tex "Surrender": the character "can unflag itself as surrendered at
// any time, as long as it is not dominated". Free, so no AP and no turn.
export function getUnsurrenderBar(state: CombatState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not in the fight'
  if (!state.surrendered.includes(id)) return 'not surrendered'
  return getAfflictions(c, getSituationalAfflictions(state, id)).includes('dominated') ? 'dominated' : null
}
