import type { SceneResume, SceneState, Updater } from '../types'
import { getOpenCalls, makeCaller, type Caller, type Calls, type Throw } from '../../play/calls'
import { getSceneModeOf } from '../rules/test'
import { getCallHappenings } from '../../character/rules/attitudes'
import { meetEachAttitude } from '../../character/commands/attitudes'
import { updateCharacter } from './characters'
import { inspire } from './inspiringDeed'

// A scene command that throws dice, run over the calls the scene has made.
// Each die is thrown the way its roller throws a test of its skill
// (`getSceneModeOf`). While any die it called for waits on the table, nothing
// it did is kept but the calls and the command to carry on with once they
// are in; once every die is in, it lands, each roller meets what their dice
// came to (abilities.tex "Promoted Attitudes", "Prohibited Attitudes"), and
// the calls are spent. While another command waits on its dice, this one is
// refused.
export function calling(resume: SceneResume, thrown: Throw, run: (caller: Caller) => Updater): Updater {
  return (state) => {
    if (getOpenCalls(state.calls).length > 0 && JSON.stringify(state.resume) !== JSON.stringify(resume)) return state
    const caller = makeCaller(state.calls, thrown, getSceneModeOf(state))
    const next = run(caller)(state)
    if (caller.waiting()) return { ...state, calls: caller.calls, resume }
    if (next === state) return state
    const met = meetCalls(next, caller.calls)
    return Object.keys(met.calls).length > 0 || met.resume ? { ...met, calls: {}, resume: null } : met
  }
}

function meetCalls(state: SceneState, calls: Calls): SceneState {
  return Object.values(calls).reduce((s, call) => {
    const happened = getCallHappenings(call)
    return happened.length > 0 ? inspire(updateCharacter(call.roller, meetEachAttitude(happened), 'conviction attitude')(s), call.roller, happened) : s
  }, state)
}

// What a die still waiting comes to in the run that called it, which is
// thrown away: nothing, so that the run goes on to call for every other die.
export const WAITING = 0
