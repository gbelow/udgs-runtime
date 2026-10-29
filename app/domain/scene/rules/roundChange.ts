import type { SceneState } from '../types'
import { ROUND_AP } from '../../tables'
import { canSurge } from '../../character/rules/surge'
import { getSustainedAbilities, isConcentrating } from '../../character/rules/concentration'
import { getOpenAction } from './log'
import { getHeldActions } from './hold'
import { getFightName } from './fighters'
import { getMoraleTurnBar } from './morale'
import { getNextStress, getStressRoundBar, getStressTurn } from './stress'
import { getChaseStartBar } from './chase'
import { isParked } from './parked'

// The round change, in the table's order: the AP of the new round come in,
// and whoever wants to rests or speaks with what is left of both rounds
// (combat.tex "Rest": resting "can make AP negative, as long as it starts
// next round positive"; "Social actions": "at the end of the round, just
// before the morale tests"); bleeding, then the environment, burning
// included (combat.tex "Environmental and ongoing effects": "applied at the
// beginning of the round"), with no AP spent on anything; the AP cut down to
// the round's ("Any unspent AP is lost") and whoever concentrates holds on,
// paying again with the focus surge, or lets go and finishes what they held;
// who joins the fight; the morale tests ("Morale test triggers": "at the
// beginning of a round"), unless a chase has started, which "always starts
// at the beginning of a new round"; and the limit stress actions they
// activate ("before anyone has had their turn").
// Only the steps it waits at: bleeding and the environment run on their own as
// the rest step is left.
// The chase comes before the morale tests (the table's ruling: a scene is a
// chase or a fight, so whoever runs away is tested by neither).
export type RoundPhase = 'rest' | 'concentration' | 'join' | 'chase' | 'morale' | 'stress'

export const ROUND_PHASES: readonly RoundPhase[] = ['rest', 'concentration', 'join', 'chase', 'morale', 'stress']

// Where the round change stands, or null while the round is played in turns.
// The morale tests and the limit stress actions follow one another as the
// tests are made and the actions taken.
export function getRoundPhase(state: SceneState): RoundPhase | null {
  if (state.roundStep !== 'morale') return state.roundStep
  return !getMoraleTurnBar(state) && (getNextStress(state) || getStressTurn(state)) ? 'stress' : 'morale'
}

// Why the round change bars something meant for the round's turns, or null.
export function getRoundChangeBar(state: SceneState): string | null {
  return state.roundStep !== null ? 'the round is changing' : null
}

// Why the round change bars what a character does of their own, or null: only
// its first step lets anyone rest or speak, and the limit stress actions are
// taken as turns of their own.
export function getRoundChangeActBar(state: SceneState): string | null {
  const phase = getRoundPhase(state)
  return phase === null || phase === 'rest' || phase === 'stress' ? null : 'the round is changing'
}

// The AP still to come before the round's own AP: none once the round change
// has handed them out.
export function getIncomingAP(state: SceneState): number {
  return state.roundStep === 'rest' ? 0 : ROUND_AP
}

// The round what is said now weighs on: at the round change, the round
// ending, whose morale tests are still to be made.
export function getSpeakingRound(state: SceneState): number {
  return state.roundStep === 'rest' ? state.round - 1 : state.round
}

function getHeldActionsOf(state: SceneState, id: string) {
  return getHeldActions(state).filter((h) => h.actorId === id)
}

// Whether the character keeps anything going through the round change: a
// held spell, an ability switched on that charges for it, or an action held
// over.
export function holdsThroughRound(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && (isConcentrating(c) || getSustainedAbilities(c).length > 0 || getHeldActionsOf(state, id).length > 0)
}

// Who still has to hold on or let go.
export function getConcentrationOwed(state: SceneState): string[] {
  if (state.roundStep !== 'concentration') return []
  return Object.keys(state.characters).filter((id) => !isParked(state, id) && holdsThroughRound(state, id) && !state.concentration.some((x) => x.id === id))
}

// Whether holding on takes the focus surge: a held spell or a held action
// does, an ability switched on does not.
export function needsFocusToHold(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && (isConcentrating(c) || getHeldActionsOf(state, id).length > 0)
}

// Why the character cannot hold on now, or null.
export function getHoldOnBar(state: SceneState, id: string): string | null {
  if (!getConcentrationOwed(state).includes(id)) return 'nothing to hold on to'
  return needsFocusToHold(state, id) && !canSurge('focus')(state.characters[id]) ? 'cannot make the focus surge' : null
}

// Why the character cannot let go now, or null.
export function getLetGoBar(state: SceneState, id: string): string | null {
  return getConcentrationOwed(state).includes(id) ? null : 'nothing to let go of'
}

// The held actions let go of and still to be played out.
export function getFinishing(state: SceneState): string[] {
  return getHeldActions(state).filter((h) => h.finishing !== null).map((h) => h.id)
}

// Why the table cannot move the round change on now, or null.
export function getContinueBar(state: SceneState): string | null {
  const phase = getRoundPhase(state)
  if (!phase) return 'the round is not changing'
  const holder = state.characters[state.inTurnCharacter] ? state.inTurnCharacter : null
  if (holder) return `${getFightName(state, holder)}'s turn`
  if (getOpenAction(state)) return 'an action is being played out'
  switch (phase) {
    case 'concentration': {
      const owed = getConcentrationOwed(state)
      if (owed.length > 0) return `waiting for ${owed.map((id) => getFightName(state, id)).join(', ')} to hold on or let go`
      return getFinishing(state).length > 0 ? 'held actions are being finished' : null
    }
    case 'morale':
      return getMoraleTurnBar(state)
    case 'stress':
      return getStressRoundBar(state) ?? 'a limit stress action is being taken'
    case 'chase':
      return getChaseStartBar(state)
    default:
      return null
  }
}
