import type { SocialAction } from '../../tables'
import type { Updater } from '../types'
import { getActionCost } from '../../character/rules/actionCosts'
import { payCost } from '../../character/commands/cost'
import { getSocialBar, getSocialTargets } from '../rules/social'
import { getSocialValue } from '../rules/morale'
import { updateCharacter } from './characters'

// combat.tex "Social actions": the character says it to each of the targets,
// the table's pick, for the 5 AP. What it weighs on their morale test is
// written now and read at the next round's beginning (`getPressure`).
export function say(id: string, kind: SocialAction, targets: string[]): Updater {
  return (state) => {
    if (getSocialBar(state, id, kind, targets)) return state
    const c = state.characters[id]
    const said = getSocialTargets(state, id, kind, targets).map((target) => ({ round: state.round, from: id, target, kind, value: getSocialValue(c) }))
    const paid = updateCharacter(id, payCost(getActionCost(c, 'socialAction')))(state)
    return { ...paid, pressure: [...paid.pressure.filter((p) => p.round >= state.round - 1), ...said] }
  }
}
