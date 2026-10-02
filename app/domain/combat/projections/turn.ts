import type { CombatState } from '../types'
import { getContestBar, getContenders, getEndTurnBar, getRollContestBar, getStartTurnBar, getSurgeTurnBar, getTurnHolder, hasAgreedToEnd, isInTurn } from '../rules/turn'
import { getFightName } from '../rules/fighters'
import { getSurgeOptions, SurgeOption } from '../../character/lenses/surge'

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
}

export function getTurnControls(state: CombatState, id: string): TurnControls {
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
  }
}

// The contest rolled for this turn, as one line: each roll, then who took
// the turn; '' before one is rolled.
function getContestResult(state: CombatState): string {
  const contest = state.lastContest
  if (!contest) return ''
  const rolls = contest.rolls.map((r) => `${getFightName(state, r.id)} ${r.score} (${r.die}+${r.skill})`).join(' · ')
  return `cunning contest: ${rolls} → ${getFightName(state, contest.winner)} takes the turn`
}

// combat.tex "Action surge" — the surge buttons in the fight: the
// character's own, with a movement or combat surge closed outside their
// turn.
export function getCombatSurgeOptions(state: CombatState, id: string): SurgeOption[] {
  const c = state.characters[id]
  if (!c) return []
  return getSurgeOptions(c).map((o) => (getSurgeTurnBar(state, id, o.kind) ? { ...o, available: false } : o))
}
