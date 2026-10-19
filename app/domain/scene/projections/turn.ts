import type { SceneState } from '../types'
import { getContestBar, getContenders, getEndTurnBar, getNextRoundBar, getRollContestBar, getStartTurnBar, getSurgeTurnBar, getTurnHolder, hasAgreedToEnd, isInTurn } from '../rules/turn'
import { getOpenAction } from '../rules/log'
import { getEndCombatBar } from '../rules/fight'
import { perState } from '../../perState'
import { getAwaited } from '../rules/options'
import { getActionNoun } from './labels'
import { getFightName } from '../rules/fighters'
import { getCompelledSurge } from '../rules/stress'
import { getSurgeOptions, SurgeOption } from '../../character/lenses/surge'
import { getFollowOptions } from '../rules/follow'
import { getStealthScore, getStealthTurn } from '../rules/stealth'

// The turn buttons as the character sees them: whose turn it is, who asked
// to contest it, whether they agree to end the round, and why each button is
// closed, null where it is open. Flat primitives, so a hook can gate on them
// shallowly.
export type TurnControls = {
  holder: string
  inTurn: boolean
  start: string | null
  contesting: boolean
  contest: string | null
  contenders: string
  roll: string | null
  end: string | null
  result: string
  agreed: boolean
  // combat.tex "Actions in stealth": whom the holder began the turn hidden
  // from, and their stealth as the turn has left it; '' when hidden from nobody
  stealth: string
}

export function getTurnControls(state: SceneState, id: string): TurnControls {
  const holder = getTurnHolder(state)
  return {
    holder: holder ? getFightName(state, holder) : '',
    inTurn: isInTurn(state, id),
    start: getStartTurnBar(state, id),
    contesting: state.contenders.includes(id),
    contest: getContestBar(state, id),
    contenders: getContenders(state).map((c) => getFightName(state, c)).join(', '),
    roll: getRollContestBar(state),
    end: getEndTurnBar(state),
    result: getContestResult(state),
    agreed: hasAgreedToEnd(state, id),
    stealth: getStealthLine(state),
  }
}

// The turn's stealth, as one line: whom its holder is hidden from, their
// score less the turn's noise, and less again to an ear when they are noisy.
function getStealthLine(state: SceneState): string {
  const turn = getStealthTurn(state)
  const score = turn ? getStealthScore(state, turn.id) : null
  if (!turn || score === null || turn.hiddenFrom.length === 0) return ''
  const names = turn.hiddenFrom.map((id) => getFightName(state, id)).join(', ')
  const heard = turn.heardAP > 0 ? `, ${score - turn.AP - turn.heardAP} to an ear` : ''
  return `${getFightName(state, turn.id)} began the turn hidden from ${names} · stealth ${score - turn.AP}${heard}`
}

// The contest rolled for this turn, as one line: each roll, then who took
// the turn; '' before one is rolled.
function getContestResult(state: SceneState): string {
  const contest = state.lastContest
  if (!contest) return ''
  const rolls = contest.rolls.map((r) => `${getFightName(state, r.id)} ${r.score} (${r.die}+${r.skill})`).join(' · ')
  return `cunning contest: ${rolls} → ${getFightName(state, contest.winner)} takes the turn`
}

// combat.tex "Action surge" — the surge buttons in the fight: the
// character's own, with a movement or combat surge closed outside their
// turn.
export function getCombatSurgeOptions(state: SceneState, id: string): SurgeOption[] {
  const c = state.characters[id]
  if (!c) return []
  return getSurgeOptions(c, getCompelledSurge(state, id)).map((o) => (getSurgeTurnBar(state, id, o.kind) ? { ...o, available: false } : o))
}

// combat.tex "Follow" — whom the character follows this round, and each one
// they may mark with why not.
export type FollowControls = { marked: string; options: { id: string; name: string; bar: string | null }[] }

export function getFollowControls(state: SceneState, id: string): FollowControls {
  return { marked: state.following[id] ?? '', options: getFollowOptions(state, id) }
}

// Why the round cannot pass, as the button says it: an action under way is
// named with whoever it still waits on to react or pass.
export const getNextRoundNote = perState((state: SceneState): string | null => getOpenNote(state) ?? getNextRoundBar(state))

// Why the combat cannot end, said the same way.
export const getEndCombatNote = perState((state: SceneState): string | null => {
  const bar = getEndCombatBar(state)
  return bar && (getOpenNote(state) ?? bar)
})

function getOpenNote(state: SceneState): string | null {
  const open = getOpenAction(state)
  if (!open) return null
  const what = `${getFightName(state, open.actorId)}'s ${getActionNoun(open)}`
  const awaited = getAwaited(state)
  return awaited.length > 0 ? `${what} waits on ${awaited.map((id) => getFightName(state, id)).join(', ')} to react or pass` : `${what} is being played out`
}
