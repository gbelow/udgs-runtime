import { NO_CONTEST } from '../rules/contest'
import type { SurgeKind } from '../../types'
import type { RollMode } from '../../play/dice'
import type { SceneState, Updater } from '../types'
import type { Throw } from '../../play/calls'
import { calling, WAITING } from './calling'
import { actionSurge } from '../../character/commands/actionSurge'
import { getContestBar, getContestable, getContenders, getContestMode, getContestModes, getContestWinner, getEndTurnBar, getRollContestBar, getStartTurnBar, getSurgeTurnBar, getTurnHolder, rollCunning } from '../rules/turn'
import { updateCharacter } from './characters'
import { discardDraft, getOpenAt } from './log'
import { getDiceBar } from '../../play/calls'
import { isContestPending } from '../rules/contest'
import { beginTurn, takeQueuedTurn } from './sequence'
import { markStress, takeStressTurn } from './stress'
import { getCompelledSurge, getStressTurn } from '../rules/stress'
import { closeTurn } from './closeTurn'
import { passFirstMoverAP } from './stoicism'

// The character's turn begins, if nobody else holds one. Nobody has asked
// to contest it yet, and the time to opens where anybody may.
export function startTurn(id: string): Updater {
  return (state) => {
    if (getStartTurnBar(state, id)) return state
    const begun = beginTurn(state, id)
    return state.contestSeconds > 0 && getContestable(begun).length > 0 ? { ...begun, contestWindow: 'open' } : begun
  }
}

// A player says they want to contest the turn, for all of their characters
// who may: the time to contest is held open until they say with whom, or
// drop it.
export function thinkContest(ids: string[]): Updater {
  return (state) => {
    const may = getContestable(state).filter((id) => ids.includes(id) && !state.thinking.includes(id))
    if (!isContestPending(state) || may.length === 0) return state
    return { ...state, thinking: [...state.thinking, ...may], letGo: state.letGo.filter((id) => !ids.includes(id)) }
  }
}

// A player has decided: with whom they have picked, or, letting the turn go,
// with nobody.
export function settleContest(ids: string[], contest: boolean): Updater {
  return (state) => {
    const may = getContestable(state).filter((id) => ids.includes(id))
    if (!isContestPending(state) || may.length === 0) return state
    if (may.every((id) => state.letGo.includes(id)) && (contest || !may.some((id) => state.contenders.includes(id)))) return state
    const dropped = contest ? [] : ids
    return {
      ...state,
      thinking: state.thinking.filter((id) => !ids.includes(id)),
      letGo: [...new Set([...state.letGo, ...may])],
      contenders: state.contenders.filter((id) => !dropped.includes(id)),
      contestModes: Object.fromEntries(Object.entries(state.contestModes).filter(([id]) => !dropped.includes(id))),
    }
  }
}

// The time to contest the turn is over: the contest is rolled if anyone asked
// for it, and the turn goes on with whoever holds it.
export function closeContest(thrown: Throw): Updater {
  return (state) => {
    if (!isContestPending(state) || getDiceBar(state.calls)) return state
    return getContenders(state).length > 0 ? rollContest(thrown)(state) : { ...state, ...NO_CONTEST, contestWindow: 'over' }
  }
}

// How long the time to contest a turn is, none at 0.
export function setContestSeconds(seconds: number): Updater {
  return (state) => ({ ...state, contestSeconds: Math.max(0, Math.round(seconds)) })
}

// How long whoever asks for time to decide is given, no limit at 0. What they
// have picked by then stands.
export function setContestDecideSeconds(seconds: number): Updater {
  return (state) => ({ ...state, contestDecideSeconds: Math.max(0, Math.round(seconds)) })
}

// The character asks to contest the turn, or takes the asking back.
export function toggleContest(id: string): Updater {
  return (state) => {
    if (state.contenders.includes(id)) {
      const { [id]: _mode, ...modes } = state.contestModes
      return { ...state, contenders: state.contenders.filter((c) => c !== id), contestModes: modes }
    }
    if (getContestBar(state, id)) return state
    return { ...state, contenders: [...state.contenders, id] }
  }
}

// play.tex "Safe and risky tests": how the character, in the contest for the
// turn, throws their cunning, among the ways their abilities allow.
export function setContestMode(id: string, mode: RollMode): Updater {
  return (state) => (getContestModes(state, id).includes(mode) ? { ...state, contestModes: { ...state.contestModes, [id]: mode } } : state)
}

// The character says they agree to end the round, or takes it back
// (combat.tex "End of the round").
export function toggleAgreeToEnd(id: string): Updater {
  return (state) => {
    if (state.agreedToEnd.includes(id)) return { ...state, agreedToEnd: state.agreedToEnd.filter((a) => a !== id) }
    return state.characters[id] ? { ...state, agreedToEnd: [...state.agreedToEnd, id] } : state
  }
}

// Each of the characters says they agree to end the round, or takes it back.
export function agreeAllToEnd(ids: string[], agree = true): Updater {
  return (state) => {
    if (!agree) return state.agreedToEnd.some((id) => ids.includes(id)) ? { ...state, agreedToEnd: state.agreedToEnd.filter((id) => !ids.includes(id)) } : state
    const agreeing = ids.filter((id) => state.characters[id] && !state.agreedToEnd.includes(id))
    return agreeing.length === 0 ? state : { ...state, agreedToEnd: [...state.agreedToEnd, ...agreeing] }
  }
}

// The contest is rolled: the holder and everyone who asked roll cunning
// (the die does not explode: play.tex "Exploding die" — only where it says),
// each in the way they picked, and the winner takes the turn, the round's first with it if it is that.
export function rollContest(thrown: Throw): Updater {
  return calling({ kind: 'contest' }, thrown, (caller) => (state) => {
    const holder = getTurnHolder(state)
    if (getRollContestBar(state) || !holder) return state
    const roll = (id: string) => {
      const callId = `contest:${id}`
      const die = caller.die({ id: callId, roller: id, label: 'cunning, for the turn', mode: getContestMode(state, id) }) ?? WAITING
      return rollCunning(state, id, die, caller.calls[callId].mode)
    }
    const rolls = [holder, ...getContenders(state)].map(roll)
    const winner = getContestWinner(rolls) ?? holder
    const won = state.firstTurn?.turn === state.turn ? state.firstTurn : null
    // what the holder had begun to declare goes with the turn
    const drafted = getOpenAt(state, 'define')
    const cleared = winner !== holder && drafted?.actorId === holder ? discardDraft(state, drafted.id) : state
    const passed = won ? passFirstMoverAP(cleared, won.id, winner) : cleared
    return { ...passed, inTurnCharacter: winner, ...NO_CONTEST, contestWindow: 'over', lastContest: { rolls, winner }, firstTurn: won ? { ...won, id: winner } : state.firstTurn }
  })
}

// The turn ends (`closeTurn`). The next turn waiting in the queue is then
// taken: the next fleer's, or the turn their flee interrupted; failing those,
// the next limit stress action owed.
export function endTurn(state: SceneState): SceneState {
  const holder = getTurnHolder(state)
  if (getEndTurnBar(state) || !holder) return state
  const settled = getStressTurn(state) ? markStress(holder, { taken: true })(state) : state
  return takeStressTurn(takeQueuedTurn(closeTurn(settled, holder)))
}

// combat.tex "Action surge", in the fight: the character's own gate — once a
// round, its price, what forbids it — and a movement or combat surge only in
// their own turn.
export function surge(id: string, kind: SurgeKind): Updater {
  return (state) => {
    if (getSurgeTurnBar(state, id, kind)) return state
    return updateCharacter(id, actionSurge(kind, getCompelledSurge(state, id) === kind), `${kind} surge`)(state)
  }
}
