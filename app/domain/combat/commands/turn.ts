import type { SurgeKind } from '../../types'
import type { CombatState, ContestRoll, Updater } from '../types'
import type { Dice } from '../dice'
import { getCunning } from '../../character/rules/skills'
import { actionSurge, endSurge } from '../../character/commands/actionSurge'
import { getContestBar, getContenders, getContestWinner, getEndTurnBar, getRollContestBar, getStartTurnBar, getSurgeTurnBar, getTurnHolder } from '../rules/turn'
import { updateCharacter } from './characters'
import { takeQueuedTurn } from './sequence'

// The character's turn begins, if nobody else holds one. Nobody has asked
// to contest it yet.
export function startTurn(id: string): Updater {
  return (state) => {
    if (getStartTurnBar(state, id)) return state
    return { ...state, inTurnCharacter: id, turnStartedAt: state.actions.length, contenders: [], lastContest: null }
  }
}

// The character asks to contest the turn, or takes the asking back.
export function toggleContest(id: string): Updater {
  return (state) => {
    if (state.contenders.includes(id)) return { ...state, contenders: state.contenders.filter((c) => c !== id) }
    if (getContestBar(state, id)) return state
    return { ...state, contenders: [...state.contenders, id] }
  }
}

// The contest is rolled: the holder and everyone who asked roll cunning
// (the die does not explode: play.tex "Exploding die" — only where it says),
// and the winner takes the turn.
export function rollContest(dice: Dice): Updater {
  return (state) => {
    const holder = getTurnHolder(state)
    if (getRollContestBar(state) || !holder) return state
    const rolls = [holder, ...getContenders(state)].map((id): ContestRoll => {
      const die = dice(false)
      const skill = getCunning(state.characters[id])
      return { id, die, skill, score: die + skill }
    })
    const winner = getContestWinner(rolls) ?? holder
    return { ...state, inTurnCharacter: winner, contenders: [], lastContest: { rolls, winner } }
  }
}

// The turn ends. The AP a movement or combat surge left unspent goes with it
// (combat.tex "Action surge": "Ending the turn loses the surge AP"), and so
// does the movement surge's free running. The
// next turn waiting in the queue is then taken: the next fleer's, or the
// turn their flee interrupted.
export function endTurn(state: CombatState): CombatState {
  const holder = getTurnHolder(state)
  if (getEndTurnBar(state) || !holder) return state
  const ended = { ...state, inTurnCharacter: '', fleeing: false, contenders: [] }
  return takeQueuedTurn(updateCharacter(holder, (c) => ({ ...endSurge(c), runsFree: false }))(ended))
}

// combat.tex "Action surge", in the fight: the character's own gate — once a
// round, its price, what forbids it — and a movement or combat surge only in
// their own turn.
export function surge(id: string, kind: SurgeKind): Updater {
  return (state) => {
    if (getSurgeTurnBar(state, id, kind)) return state
    return updateCharacter(id, actionSurge(kind))(state)
  }
}
