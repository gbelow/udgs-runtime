import type { SocialAction } from '../../tables'
import type { Updater } from '../types'
import { getActionCost } from '../../character/rules/actionCosts'
import { payCost } from '../../character/commands/cost'
import { getSayBar, getSocialBar, getSocialTargets, getSurrenderBar, getUnsurrenderBar } from '../rules/social'
import { getSocialValue } from '../rules/morale'
import { updateCharacter } from './characters'

const paySocial = (id: string): Updater => (state) =>
  updateCharacter(id, (c) => payCost(getActionCost(c, 'socialAction'))(c))(state)

// combat.tex "Social actions": the character says it to each of the targets,
// the table's pick, for the 5 AP. What it weighs on their morale test is
// written now and read at the next round's beginning (`getPressure`).
export function say(id: string, kind: SocialAction, targets: string[]): Updater {
  return (state) => {
    if (getSayBar(state, id, kind, targets)) return state
    const value = getSocialValue(state.characters[id])
    const said = getSocialTargets(state, id, kind, targets).map((target) => ({ round: state.round, from: id, target, kind, value }))
    const paid = paySocial(id)(state)
    return { ...paid, pressure: [...paid.pressure.filter((p) => p.round >= state.round - 1), ...said] }
  }
}

// combat.tex "Surrender": flags the character surrendered for the 5 AP.
export function surrender(id: string): Updater {
  return (state) => {
    if (getSurrenderBar(state, id)) return state
    const paid = paySocial(id)(state)
    return { ...paid, surrendered: [...paid.surrendered, id] }
  }
}

export function unsurrender(id: string): Updater {
  return (state) => (getUnsurrenderBar(state, id) ? state : { ...state, surrendered: state.surrendered.filter((s) => s !== id) })
}

// combat.tex "Negotiation": the 5 AP. The test and what it comes to are the
// table's.
export function negotiate(id: string): Updater {
  return (state) => (getSocialBar(state, id) ? state : paySocial(id)(state))
}
