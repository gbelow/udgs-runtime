import { isCombatStarted } from './started'
import type { SurgeKind } from '../../types'
import type { SceneState, ContestRoll } from '../types'
import { SURGES } from '../../tables'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { canSurgeAtAll, hasAPLeft } from '../../character/rules/surge'
import { getLiveActions, getOpenAction, getPlayingOutBar } from './log'
import { getFightName } from './fighters'
import { getMoraleTurnBar } from './morale'
import { getHeldTurnBar } from './heldRoll'
import { getStressEndBar, getStressRoundBar, getStressStartBar, getStressTurn } from './stress'
import type { Dice } from '../../play/dice'
import { getCunning } from '../../character/rules/skills'
import { getChaseTurnBar, getRoutingTerms, isIdleInChase } from './chase'
import { getRoundChangeBar } from './roundChange'
import { sumTerms } from '../../character/rules/terms'

// play.tex "Combat": each character acts in turns "decided on a 'first to
// ask, first to play' basis that can be contested by other characters". A
// character takes actions only in their own turn; outside it, only
// reactions and what they open. After a reaction surge no turn can be
// started that round (combat.tex "Action surge").

export function isInTurn(state: SceneState, id: string): boolean {
  return id !== '' && state.inTurnCharacter === id
}

// Why the character cannot handle their gear now, or null: once the fight
// has started, drawing, stowing, donning, dropping and every other move with
// what they carry waits for their own turn, free or not. Before the first
// round they are not yet fighting; the GM handles anyone's at any time.
export function getGearBar(state: SceneState, id: string, gm = false): string | null {
  return !gm && state.round > 0 && !isInTurn(state, id) ? 'gear is handled only on their own turn' : null
}

// Who holds the turn, if they are still in the fight.
export function getTurnHolder(state: SceneState): string | null {
  return state.characters[state.inTurnCharacter] ? state.inTurnCharacter : null
}

// Why the character cannot take a turn this round, whoever holds it now.
function getTurnlessReason(state: SceneState, id: string): string | null {
  const c = state.characters[id]
  if (!c) return 'not in the fight'
  if (isDead(c)) return 'dead'
  if (hasAffliction(c, 'unconscious')) return 'unconscious'
  if (c.usedSurge === 'reaction') return 'reaction surge used this round'
  return null
}

// Why the character cannot start a turn now, or null: the combat must have
// started, nobody else may hold one, nothing may be being played out, and the round change (its morale
// tests among it: combat.tex "Morale", "at the beginning of a round") comes
// first.
export function getStartTurnBar(state: SceneState, id: string): string | null {
  if (!isCombatStarted(state)) return 'combat has not started'
  if (getTurnHolder(state) === id) return 'already in turn'
  return getFightBusy(state) ?? getRoundChangeBar(state) ?? getTurnlessReason(state, id) ?? getChaseTurnBar(state, id) ?? getMoraleTurnBar(state) ?? getHeldTurnBar(state) ?? getStressStartBar(state, id)
}

// What the fight is busy with, if anything: someone's turn, or an action
// being played out.
export function getFightBusy(state: SceneState): string | null {
  const holder = getTurnHolder(state)
  if (holder) return `${getFightName(state, holder)}'s turn`
  return getPlayingOutBar(state)
}

// Why the turn cannot be contested now, by anyone: someone must hold it,
// have declared nothing in it yet, and it must not have been contested.
function getContestClosed(state: SceneState): string | null {
  if (!getTurnHolder(state)) return 'nobody is in turn'
  if (state.fleeing) return 'the turn is a flee'
  if (state.forcedSurge !== '') return 'the turn was forced by a feint'
  if (getStressTurn(state)) return 'the turn is a limit stress action'
  if (state.lastContest) return 'the turn was contested'
  if (state.turnsTaken.some((t) => t.turn === state.turn) || getLiveActions(state).some((a) => a.turn === state.turn)) return 'the turn is under way'
  return null
}

// Why the character cannot ask to contest the turn now, or null.
export function getContestBar(state: SceneState, id: string): string | null {
  if (getTurnHolder(state) === id) return 'your own turn'
  return getContestClosed(state) ?? getTurnlessReason(state, id)
}

// Why the contest cannot be rolled now, or null: somebody has to have asked.
export function getRollContestBar(state: SceneState): string | null {
  return getContestClosed(state) ?? (getContenders(state).length === 0 ? 'nobody contests the turn' : null)
}

// Who has asked to contest the turn and still may.
export function getContenders(state: SceneState): string[] {
  return state.contenders.filter((id) => getContestBar(state, id) === null)
}

// A contest for the turn: everyone in it, the holder too, rolls cunning and
// the highest takes the turn; a tie goes to whoever asked first, the holder
// before anyone (play.tex "Combat": "first to ask, first to play").
export function getContestWinner(rolls: ContestRoll[]): string | null {
  return rolls.reduce<ContestRoll | null>((best, r) => (best === null || r.score > best.score ? r : best), null)?.id ?? null
}

// One contender's cunning roll (the die does not explode: play.tex
// "Exploding die" — only where it says), with the routing bonus of a chase.
export function rollCunning(state: SceneState, id: string, dice: Dice): ContestRoll {
  const die = dice(false)
  const skill = getCunning(state.characters[id]) + sumTerms(getRoutingTerms(state, id))
  return { id, die, skill, score: die + skill }
}

// Why the character cannot make a movement or combat surge now, or null:
// those are made only in the character's own turn — and in a flee turn,
// only the movement surge (combat.tex "Flee"). There are none before the
// combat has started.
export function getSurgeTurnBar(state: SceneState, id: string, kind: SurgeKind): string | null {
  if (!isCombatStarted(state)) return 'combat has not started'
  if (state.fleeing && isInTurn(state, id) && kind !== 'movement') return 'fleeing'
  return SURGES[kind].earmarked && !isInTurn(state, id) ? 'only in your own turn' : null
}

// combat.tex "End of the round": "A round ends when no one has AP left and
// the remaining agree to end the round." Someone agrees by saying so, or
// without saying anything once they have no AP left and no surge that
// would give them more, or nothing to do in a chase round; the dead have
// nothing left to agree to.
export function hasAgreedToEnd(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  if (!c) return true
  return state.agreedToEnd.includes(id) || isDead(c) || !hasAPLeft(c) || isIdleInChase(state, id)
}

// Why the round cannot be passed now, or null: a turn under way has to be
// ended first, the table's ruling, and everyone has to agree. Before the
// first round there is no round to end, so the fight starts at once.
export function getNextRoundBar(state: SceneState): string | null {
  const busy = getFightBusy(state) ?? getRoundChangeBar(state)
  if (busy) return busy
  if (state.round === 0) return null
  const owed = getStressRoundBar(state)
  if (owed) return owed
  const waiting = Object.keys(state.characters).filter((id) => !hasAgreedToEnd(state, id))
  return waiting.length > 0 ? `waiting for ${waiting.map((id) => getFightName(state, id)).join(', ')} to agree` : null
}

// combat.tex "Feint": the one a feint forced to take their turn ends it only
// once they have used an action surge — or can no longer pay for one.
function getForcedSurgeBar(state: SceneState, holder: string): string | null {
  const c = state.characters[holder]
  if (state.forcedSurge !== holder || !c || c.usedSurge !== null) return null
  return canSurgeAtAll(c) ? 'forced to use an action surge' : null
}

// Why the turn cannot be ended now, or null.
export function getEndTurnBar(state: SceneState): string | null {
  const holder = getTurnHolder(state)
  if (!holder) return 'nobody is in turn'
  return getOpenAction(state) ? 'an action is being played out' : getForcedSurgeBar(state, holder) ?? getStressEndBar(state)
}
