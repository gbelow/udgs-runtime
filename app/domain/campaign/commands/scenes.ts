import type { CampaignUpdater } from '../types'
import { getLoadSceneBar, getPassByBar, getScenePreset } from '../rules/scenes'
import { getPartyPlayers } from '../rules/place'
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
      kind: 'scene', party: waiting.party || null, title: 'passed a scene by',
      lines: [`${getScenePreset(waiting.preset).name}${waiting.event ? `, from ${waiting.event}` : ''}${names ? ` (${names})` : ''}`],
    })({ ...state, scenes: without(state.scenes, sceneId) })
  }
}

// Who plays a line of the waiting scene's parties, said by the table for
// this scene alone: a bot or a member, or null for the GM. The preset keeps
// its own word for the next time it is met.
export function setScenePlayer(sceneId: string, slot: string, player: string | null): CampaignUpdater {
  return (state) => {
    const waiting = state.scenes[sceneId]
    if (!waiting) return state
    return { ...state, scenes: { ...state.scenes, [sceneId]: { ...waiting, players: { ...waiting.players, [slot]: player } } } }
  }
}

// A scene of the catalog loaded by the table rather than met by an event,
// waiting to be played: by the members of `partyId` on the roster, where the
// party stands, or by nobody sent from the campaign, at no place.
export function loadScene(sceneId: string, preset: string, partyId: string | null): CampaignUpdater {
  return (state) => {
    if (getLoadSceneBar(preset) || (partyId !== null && !state.parties[partyId])) return state
    const members = partyId === null ? [] : getPartyPlayers(state, partyId)
    const at = partyId === null ? null : state.parties[partyId].at
    return { ...state, scenes: { ...state.scenes, [sceneId]: { preset, party: partyId ?? '', members, forced: false, event: '', at, players: {} } } }
  }
}
