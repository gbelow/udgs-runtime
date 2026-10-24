import type { SceneResume, Updater } from '../types'
import { answerCall, getOpenCalls, type Throw } from '../../play/calls'
import type { DieSource } from '../../play/dice'
import { acceptSpellTest, payAction, resolveAction, rollAction, withdrawSpawnedAction } from './action'
import { rollContest } from './turn'
import { continueRound, holdOn, letGo, nextRound } from './nextRound'
import { endCombat } from './endCombat'
import { followScene } from './parked'
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
    case 'followScene': return followScene(resume.partyId, thrown)
    case 'resolveChase':
    case 'cross':
      return (state) => state
  }
}

// A die the scene called for, typed in from the table or rolled on the
// screen; the last die called for carries on the command that called them.
export function answerScene(callId: string, die: number, source: DieSource, thrown: Throw, newId: () => string): Updater {
  return (state) => {
    const calls = answerCall(state.calls, callId, die, source)
    if (calls === state.calls) return state
    const answered = { ...state, calls }
    if (getOpenCalls(calls).length > 0 || !state.resume) return answered
    return resumeWith(state.resume, thrown, newId)(answered)
  }
}
