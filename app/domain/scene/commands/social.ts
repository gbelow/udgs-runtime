import { INSULT_BONUS } from '../../tables'
import type { SceneState, Pressure, SocialActionRecord, TauntAction, Updater } from '../types'
import { getStressSocial } from '../rules/stress'
import { getSocialValue } from '../rules/morale'
import { getSpeakingRound } from '../rules/roundChange'
import { isVoided } from '../rules/opportunity'
import { getHeard } from '../rules/social'
import { markStress } from './stress'

// What was said, written as the pressure it puts on each hearer's morale test,
// read at the next round's beginning (`getPressure`) — said at the round
// change, the one it is changing to.
function speak(state: SceneState, id: string, kind: Pressure['kind'], value: number, heard: string[]): SceneState {
  const round = getSpeakingRound(state)
  const said = heard.map((target) => ({ round, from: id, target, kind, value }))
  return { ...state, pressure: [...state.pressure.filter((p) => p.round >= round - 1), ...said] }
}

// combat.tex "Social actions": what a social action leaves once it lands,
// its 5 AP already paid with it. An intimidation, a rally or a taunt weighs
// on its hearers' morale; an abusive's insult (creating.tex "Limit Stress
// Actions") weighs its own bonus and does the duty, as a negotiation does a
// traitor's; a surrender raises the flag, an unsurrender lowers it.
export function landSocial(state: SceneState, action: SocialActionRecord | TauntAction): SceneState {
  const c = state.characters[action.actorId]
  if (!c || isVoided(state, action)) return state
  if (action.kind === 'taunt') return action.targetId ? speak(state, c.id, 'taunt', getSocialValue(c), [action.targetId]) : state
  switch (action.say) {
    case 'intimidate':
    case 'rally':
      return speak(state, c.id, action.say, getSocialValue(c), getHeard(state, c.id, action.say))
    case 'insult':
      return markStress(c.id, { acted: true })(speak(state, c.id, 'insult', INSULT_BONUS, getHeard(state, c.id, 'insult')))
    case 'negotiate':
      return getStressSocial(state, c.id) === 'negotiate' ? markStress(c.id, { acted: true })(state) : state
    case 'surrender':
      return state.surrendered.includes(c.id) ? state : { ...state, surrendered: [...state.surrendered, c.id] }
    case 'unsurrender':
      return { ...state, surrendered: state.surrendered.filter((s) => s !== c.id) }
  }
}

// creating.tex "Limit Stress Actions": the table finds nobody for the abusive
// to insult, or nobody who can communicate for the traitor to negotiate with,
// so they "default to coward".
export function defaultToCoward(id: string): Updater {
  return (state) => (getStressSocial(state, id) ? markStress(id, { action: 'coward' })(state) : state)
}
