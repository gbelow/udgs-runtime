import { INSULT_BONUS, type SocialAction } from '../../tables'
import type { CombatState, Pressure, Updater } from '../types'
import { getActionCost } from '../../character/rules/actionCosts'
import { payCost } from '../../character/commands/cost'
import { getInsultBar, getOthers, getSayBar, getSocialBar, getSocialTargets, getSurrenderBar, getUnsurrenderBar } from '../rules/social'
import { getStressSocial } from '../rules/stress'
import { getSocialValue } from '../rules/morale'
import { updateCharacter } from './characters'
import { markStress } from './stress'

const paySocial = (id: string): Updater => (state) =>
  updateCharacter(id, (c) => payCost(getActionCost(c, 'socialAction'))(c))(state)

// The 5 AP paid, and what the character said written as the pressure it puts
// on each target's morale test, read at the next round's beginning
// (`getPressure`).
function speak(state: CombatState, id: string, kind: Pressure['kind'], value: number, targets: string[]): CombatState {
  const paid = paySocial(id)(state)
  const said = targets.map((target) => ({ round: state.round, from: id, target, kind, value }))
  return { ...paid, pressure: [...paid.pressure.filter((p) => p.round >= state.round - 1), ...said] }
}

// combat.tex "Social actions": the character says it to each of the targets,
// the table's pick, for the 5 AP.
export function say(id: string, kind: SocialAction, targets: string[]): Updater {
  return (state) => {
    if (getSayBar(state, id, kind, targets)) return state
    return speak(state, id, kind, getSocialValue(state.characters[id]), getSocialTargets(state, id, kind, targets))
  }
}

// creating.tex "Limit Stress Actions": the insult an abusive character's owed
// turn compels, said to whoever the table picks.
export function insult(id: string, targets: string[]): Updater {
  return (state) => {
    if (getInsultBar(state, id, targets)) return state
    return markStress(id, { acted: true })(speak(state, id, 'insult', INSULT_BONUS, getOthers(state, id, targets)))
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
  return (state) => {
    if (getSocialBar(state, id)) return state
    const paid = paySocial(id)(state)
    return getStressSocial(state, id) === 'negotiate' ? markStress(id, { acted: true })(paid) : paid
  }
}

// creating.tex "Limit Stress Actions": the table finds nobody for the abusive
// to insult, or nobody who can communicate for the traitor to negotiate with,
// so they "default to coward".
export function defaultToCoward(id: string): Updater {
  return (state) => (getStressSocial(state, id) ? markStress(id, { action: 'coward' })(state) : state)
}
