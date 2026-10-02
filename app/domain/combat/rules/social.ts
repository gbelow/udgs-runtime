import type { SocialAction } from '../../tables'
import type { CombatState } from '../types'
import { getActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { getOpenAction } from './log'
import { isInTurn } from './turn'

// Who a social action is said to: others in the fight, once each. combat.tex
// "Taunt": a taunt "triggers a morale test for one enemy".
export function getSocialTargets(state: CombatState, id: string, kind: SocialAction, targets: string[]): string[] {
  const said = targets.filter((t, i) => t !== id && state.characters[t] && targets.indexOf(t) === i)
  return kind === 'taunt' ? said.slice(0, 1) : said
}

// combat.tex "Social actions": "Every social action costs 5 AP and counts as
// a Rest action". Why the character cannot say one now, or null: in their own
// turn like any action, with nothing being played out and the AP to pay.
export function getSocialBar(state: CombatState, id: string, kind: SocialAction, targets: string[]): string | null {
  const c = state.characters[id]
  if (!c) return 'not in the fight'
  if (!isInTurn(state, id)) return 'only in your own turn'
  if (getOpenAction(state)) return 'an action is being played out'
  if (!canAfford(c, getActionCost(c, 'socialAction'))) return 'not enough AP'
  return getSocialTargets(state, id, kind, targets).length === 0 ? 'nobody to say it to' : null
}
