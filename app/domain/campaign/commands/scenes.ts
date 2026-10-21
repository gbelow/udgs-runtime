import type { CampaignUpdater } from '../types'
import { getPassByBar, getScenePreset } from '../rules/scenes'
import { getRosterName } from '../rules/roster'
import { record } from './journal'
import { without } from '../../utils'

// An offered scene passed by: it is gone, and the journal says so; refused
// for a forced one (`getPassByBar`).
export function passBy(sceneId: string): CampaignUpdater {
  return (state) => {
    if (getPassByBar(state, sceneId)) return state
    const waiting = state.scenes[sceneId]
    const names = waiting.members.map((id) => getRosterName(state, id)).join(', ')
    return record({
      kind: 'scene', party: waiting.party, title: 'passed a scene by',
      lines: [`${getScenePreset(waiting.preset).name}${waiting.event ? `, from ${waiting.event}` : ''}${names ? ` (${names})` : ''}`],
    })({ ...state, scenes: without(state.scenes, sceneId) })
  }
}
