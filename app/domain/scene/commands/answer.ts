import type { SceneResume, Updater } from '../types'
import { answerCall, getOpenCalls, type Throw } from '../../play/calls'
import { getCancelling } from '../rules/calls'
import { getOpenAction } from '../rules/log'
import { withdrawActions } from './log'
import { advance } from './sequence'
import { calling } from './calling'
import { acceptSpellTest, payAction, resolveAction, rollAction, withdrawSpawnedAction } from './action'
import { rollContest } from './turn'
import { continueRound, holdOn, letGo, nextRound } from './nextRound'
import { endCombat } from './endCombat'
import { resumeChase } from './chase'

function resumeWith(resume: SceneResume, thrown: Throw, newId: () => string): Updater {
  const chase = resumeChase(resume, thrown)
  if (chase) return chase
  switch (resume.kind) {
    case 'roll': return rollAction(thrown, newId)
    case 'pay': return payAction(newId, thrown)
    case 'resolve': return resolveAction(newId, thrown)
    case 'accept': return acceptSpellTest(newId, thrown)
    case 'withdrawSpawned': return withdrawSpawnedAction(thrown, newId)
    case 'contest': return rollContest(thrown)
    case 'nextRound': return nextRound(thrown)
    case 'continueRound': return continueRound(thrown)
    case 'holdOn': return holdOn(resume.id, thrown)
    case 'letGo': return letGo(resume.id, thrown)
    case 'endCombat': return endCombat(thrown)
    case 'resolveChase':
    case 'cross':
      return (state) => state
  }
}

// A die the scene called for, typed in from the table or rolled on the
// screen; the last die called for carries on the command that called them.
export function answerScene(callId: string, die: number, entered: boolean, thrown: Throw, newId: () => string): Updater {
  return (state) => {
    const calls = answerCall(state.calls, callId, die, entered)
    if (calls === state.calls) return state
    const answered = { ...state, calls }
    if (getOpenCalls(calls).length > 0 || !state.resume) return answered
    return resumeWith(state.resume, thrown, newId)(answered)
  }
}

// The GM's way out of a die nobody throws (the table's ruling): only what the
// die was called for is taken back — the reaction, the action with what
// answers it, the ask for the turn — never the whole exchange it waits in, and
// whatever else waits on the table goes on.
export function cancelCall(callId: string, thrown: Throw, newId: () => string): Updater {
  return (state) => {
    const cancelling = getCancelling(state, callId)
    const resume = state.resume
    if (!cancelling || !resume) return state
    if (cancelling.kind === 'contender') return resumeWith(resume, thrown, newId)({ ...state, contenders: state.contenders.filter((id) => id !== cancelling.id) })
    const withdrawn = withdrawActions(state, cancelling.ids, 'cancelledByGM')
    const root = cancelling.ids[0] === getOpenAction(state)?.id
    if (!root) return resumeWith(resume, thrown, newId)(withdrawn)
    const cleared = { ...withdrawn, calls: {}, resume: null }
    return cancelling.spawned ? calling({ kind: 'withdrawSpawned' }, thrown, (caller) => (s) => advance(s, newId, caller))(cleared) : cleared
  }
}
