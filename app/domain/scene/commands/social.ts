import { INSULT_BONUS } from '../../tables'
import type { SceneState, Pressure, SocialActionRecord, TauntAction, Updater } from '../types'
import { getStressSocial } from '../rules/stress'
import { getSocialValue } from '../rules/morale'
import { getSpeakingRound } from '../rules/roundChange'
import { isVoided } from '../rules/opportunity'
import { getHeard } from '../rules/social'
import { hasGrant } from '../../character/rules/effects'
import { markStress } from './stress'
import { updateCharacter } from './characters'
import { braveTheOdds, raiseSurrenderFlag } from './providence'

// What was said, written as the pressure it puts on each hearer's morale test,
// read at the next round's beginning (`getPressure`) — said at the round
// change, the one it is changing to.
export function speak(state: SceneState, id: string, kind: Pressure['kind'], value: number, heard: string[]): SceneState {
  const round = getSpeakingRound(state)
  const said = heard.map((target) => ({ round, from: id, target, kind, value }))
  const spoken = { ...state, pressure: [...state.pressure.filter((p) => p.round >= round - 1), ...said] }
  return kind === 'rally' ? lendLeadership(spoken, id) : spoken
}

// abilities.tex "Leadership": "+1 to all skills in a round when they rallied
// their team", the buff the ability lists while `rallied` holds.
function lendLeadership(state: SceneState, id: string): SceneState {
  const c = state.characters[id]
  return c && hasGrant(c, 'leadership') && !c.rallied ? updateCharacter(id, (x) => ({ ...x, rallied: true }), 'Leadership')(state) : state
}

// combat.tex "Social actions": what a social action leaves once it lands,
// its 5 AP already paid with it. An intimidation, a rally or a taunt weighs
// on its hearers' morale; an abusive's insult (creating.tex "Limit Stress
// Actions") weighs its own bonus and does the duty, as a negotiation does a
// traitor's; a surrender raises the flag, an unsurrender lowers it.
export function landSocial(state: SceneState, action: SocialActionRecord | TauntAction): SceneState {
  const c = state.characters[action.actorId]
  if (!c || isVoided(state, action)) return state
  if (action.kind === 'taunt') return action.targetId ? rallyingTaunt(speak(state, c.id, 'taunt', getSocialValue(c, 'taunt'), [action.targetId]), c.id) : state
  switch (action.say) {
    case 'intimidate':
      return braveTheOdds(speak(state, c.id, 'intimidate', getSocialValue(c, 'intimidate'), getHeard(state, c.id, 'intimidate')), c.id)
    case 'rally':
      return speak(state, c.id, 'rally', getSocialValue(c, 'rally'), getHeard(state, c.id, 'rally'))
    case 'insult':
      return markStress(c.id, { acted: true })(speak(state, c.id, 'insult', INSULT_BONUS, getHeard(state, c.id, 'insult')))
    case 'negotiate':
      return getStressSocial(state, c.id) === 'negotiate' ? markStress(c.id, { acted: true })(state) : state
    case 'surrender':
      return raiseSurrenderFlag(state, c.id)
    case 'unsurrender':
      return { ...state, surrendered: state.surrendered.filter((s) => s !== c.id) }
  }
}

// combat.tex "Rally", said by the character as something else makes it
// (abilities.tex "Rallying Guard").
export function rally(state: SceneState, id: string): SceneState {
  const c = state.characters[id]
  return c ? speak(state, id, 'rally', getSocialValue(c, 'rally'), getHeard(state, id, 'rally')) : state
}

// abilities.tex "Sharp Tongue": "Also rallies their team when they taunt an
// enemy".
function rallyingTaunt(state: SceneState, id: string): SceneState {
  const c = state.characters[id]
  return c && hasGrant(c, 'rallyingTaunt') ? rally(state, id) : state
}

// creating.tex "Limit Stress Actions": the table finds nobody for the abusive
// to insult, or nobody who can communicate for the traitor to negotiate with,
// so they "default to coward".
export function defaultToCoward(id: string): Updater {
  return (state) => (getStressSocial(state, id) ? markStress(id, { action: 'coward' })(state) : state)
}
