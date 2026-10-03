import type { CampaignCharacter, SurgeKind } from '../../types'
import type { CombatState, ContestRoll } from '../types'
import { SURGES } from '../../tables'
import { isDead } from '../../character/rules/afflictions'
import { canSurgeAtAll, hasAPLeft } from '../../character/rules/surge'
import { getOpenAction } from './log'
import { getFightName } from './fighters'
import { getMoraleTurnBar } from './morale'
import { getStressEndBar, getStressRoundBar, getStressStartBar, getStressTurn } from './stress'

// play.tex "Combat": each character acts in turns "decided on a 'first to
// ask, first to play' basis that can be contested by other characters". A
// character takes actions only in their own turn; outside it, only
// reactions and what they open. After a reaction surge no turn can be
// started that round (combat.tex "Action surge").

export function isInTurn(state: CombatState, id: string): boolean {
  return id !== '' && state.inTurnCharacter === id
}

// Whether a change to a character spends AP they have no turn to spend it
// in: what costs AP (an item drawn or stowed, a shield slid) waits for their
// own turn, what is free does not.
export function isSpendingOutOfTurn(state: CombatState, before: CampaignCharacter, after: CampaignCharacter): boolean {
  return !isInTurn(state, before.id) && after.resources.AP < before.resources.AP
}

// Who holds the turn, if they are still in the fight.
export function getTurnHolder(state: CombatState): string | null {
  return state.characters[state.inTurnCharacter] ? state.inTurnCharacter : null
}

// Why the character cannot take a turn this round, whoever holds it now.
function getTurnlessReason(state: CombatState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not in the fight'
  if (isDead(c)) return 'dead'
  if (c.usedSurge === 'reaction') return 'reaction surge used this round'
  return null
}

// Why the character cannot start a turn now, or null: nobody else may hold
// one, nothing may be being played out, and the round's morale tests (combat.tex
// "Morale": "at the beginning of a round") come first.
export function getStartTurnBar(state: CombatState, id: string): string | null {
  if (getTurnHolder(state) === id) return 'already in turn'
  return getFightBusy(state) ?? getTurnlessReason(state, id) ?? getMoraleTurnBar(state) ?? getStressStartBar(state, id)
}

// What the fight is busy with, if anything: someone's turn, or an action
// being played out.
function getFightBusy(state: CombatState): string | null {
  const holder = getTurnHolder(state)
  if (holder) return `${getFightName(state, holder)}'s turn`
  return getOpenAction(state) ? 'an action is being played out' : null
}

// Why the turn cannot be contested now, by anyone: someone must hold it,
// have declared nothing in it yet, and it must not have been contested.
function getContestClosed(state: CombatState): string | null {
  if (!getTurnHolder(state)) return 'nobody is in turn'
  if (state.fleeing) return 'the turn is a flee'
  if (state.forcedSurge !== '') return 'the turn was forced by a feint'
  if (getStressTurn(state)) return 'the turn is a limit stress action'
  if (state.lastContest) return 'the turn was contested'
  if (state.actions.length > state.turnStartedAt) return 'the turn is under way'
  return null
}

// Why the character cannot ask to contest the turn now, or null.
export function getContestBar(state: CombatState, id: string): string | null {
  if (getTurnHolder(state) === id) return 'your own turn'
  return getContestClosed(state) ?? getTurnlessReason(state, id)
}

// Why the contest cannot be rolled now, or null: somebody has to have asked.
export function getRollContestBar(state: CombatState): string | null {
  return getContestClosed(state) ?? (getContenders(state).length === 0 ? 'nobody contests the turn' : null)
}

// Who has asked to contest the turn and still may.
export function getContenders(state: CombatState): string[] {
  return state.contenders.filter((id) => getContestBar(state, id) === null)
}

// A contest for the turn: everyone in it, the holder too, rolls cunning and
// the highest takes the turn; a tie goes to whoever asked first, the holder
// before anyone (play.tex "Combat": "first to ask, first to play").
export function getContestWinner(rolls: ContestRoll[]): string | null {
  return rolls.reduce<ContestRoll | null>((best, r) => (best === null || r.score > best.score ? r : best), null)?.id ?? null
}

// Why the character cannot make a movement or combat surge now, or null:
// those are made only in the character's own turn — and in a flee turn,
// only the movement surge (combat.tex "Flee").
export function getSurgeTurnBar(state: CombatState, id: string, kind: SurgeKind): string | null {
  if (state.fleeing && isInTurn(state, id) && kind !== 'movement') return 'fleeing'
  return SURGES[kind].earmarked && !isInTurn(state, id) ? 'only in your own turn' : null
}

// combat.tex "End of the round": "A round ends when no one has AP left and
// the remaining agree to end the round." Someone agrees by saying so, or
// without saying anything once they have no AP left and no surge that
// would give them more; the dead have nothing left to agree to.
export function hasAgreedToEnd(state: CombatState, id: string): boolean {
  const c = state.characters[id]
  if (!c) return true
  return state.agreedToEnd.includes(id) || isDead(c) || !hasAPLeft(c)
}

// Why the round cannot be passed now, or null: a turn under way has to be
// ended first, the table's ruling, and everyone has to agree.
export function getNextRoundBar(state: CombatState): string | null {
  const busy = getFightBusy(state)
  if (busy) return busy
  const owed = getStressRoundBar(state)
  if (owed) return owed
  const waiting = Object.keys(state.characters).filter((id) => !hasAgreedToEnd(state, id))
  return waiting.length > 0 ? `waiting for ${waiting.map((id) => getFightName(state, id)).join(', ')} to agree` : null
}

// combat.tex "Feint": the one a feint forced to take their turn ends it only
// once they have used an action surge — or can no longer pay for one.
function getForcedSurgeBar(state: CombatState, holder: string): string | null {
  const c = state.characters[holder]
  if (state.forcedSurge !== holder || !c || c.usedSurge !== null) return null
  return canSurgeAtAll(c) ? 'forced to use an action surge' : null
}

// Why the turn cannot be ended now, or null.
export function getEndTurnBar(state: CombatState): string | null {
  const holder = getTurnHolder(state)
  if (!holder) return 'nobody is in turn'
  return getOpenAction(state) ? 'an action is being played out' : getForcedSurgeBar(state, holder) ?? getStressEndBar(state)
}
