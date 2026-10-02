import type { SurgeKind } from '../../types'
import type { CombatState, ContestRoll } from '../types'
import { SURGES } from '../../tables'
import { isDead } from '../../character/rules/afflictions'
import { hasAPLeft } from '../../character/rules/surge'
import { getOpenAction } from './log'
import { getFightName } from './fighters'

// play.tex "Combat": each character acts in turns "decided on a 'first to
// ask, first to play' basis that can be contested by other characters". A
// character takes actions only in their own turn; outside it, only
// reactions and what they open. After a reaction surge no turn can be
// started that round (combat.tex "Action surge").

export function isInTurn(state: CombatState, id: string): boolean {
  return id !== '' && state.inTurnCharacter === id
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
// one and nothing may be being played out.
export function getStartTurnBar(state: CombatState, id: string): string | null {
  if (getTurnHolder(state) === id) return 'already in turn'
  return getFightBusy(state) ?? getTurnlessReason(state, id)
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
  const waiting = Object.keys(state.characters).filter((id) => !hasAgreedToEnd(state, id))
  return waiting.length > 0 ? `waiting for ${waiting.map((id) => getFightName(state, id)).join(', ')} to agree` : null
}

// Why the turn cannot be ended now, or null.
export function getEndTurnBar(state: CombatState): string | null {
  if (!getTurnHolder(state)) return 'nobody is in turn'
  return getOpenAction(state) ? 'an action is being played out' : null
}
