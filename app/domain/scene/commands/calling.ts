import type { SceneResume, Updater } from '../types'
import { getOpenCalls, makeCaller, type Caller, type Throw } from '../../play/calls'

// A scene command that throws dice, run over the calls the scene has made.
// While any die it called for waits on the table, nothing it did is kept but
// the calls and the command to carry on with once they are in; once every die
// is in, it lands, and the calls are spent. While another command waits on its
// dice, this one is refused.
export function calling(resume: SceneResume, thrown: Throw, run: (caller: Caller) => Updater): Updater {
  return (state) => {
    if (getOpenCalls(state.calls).length > 0 && JSON.stringify(state.resume) !== JSON.stringify(resume)) return state
    const caller = makeCaller(state.calls, thrown)
    const next = run(caller)(state)
    if (caller.waiting()) return { ...state, calls: caller.calls, resume }
    if (next === state) return state
    return Object.keys(next.calls).length > 0 || next.resume ? { ...next, calls: {}, resume: null } : next
  }
}

// What a die still waiting comes to in the run that called it, which is
// thrown away: nothing, so that the run goes on to call for every other die.
export const WAITING = 0
