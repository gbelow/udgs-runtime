import type { CampaignState, WaitingScene } from '../types'
import { getPlaySceneBar, getSceneKeys, getScenePlayer, getScenePreset, getSceneSlot } from '../rules/scenes'
import { getRosterName } from '../rules/roster'

// A prepared scene waiting to be played: what the table needs to play it (a
// shared battle map's name and the catalog characters it is played with, by
// key), who meets it, the parties it brings in and who plays each line of
// them now.
export type WaitingSceneView = {
  id: string
  name: string
  text: string
  event: string
  forced: boolean
  members: string[]
  board: string
  keys: string[]
  parties: { name: string; members: { slot: string; key: string; count: number; player: string | null }[] }[]
  playBar: string | null
}

export function getWaitingSceneView(state: CampaignState, id: string, s: WaitingScene): WaitingSceneView {
  const preset = getScenePreset(s.preset)
  return {
    id, name: preset.name, text: preset.text, event: s.event, forced: s.forced, members: s.members.map((m) => getRosterName(state, m)),
    board: preset.board, keys: getSceneKeys(s),
    parties: preset.parties.map((party, p) => ({
      name: party.name || `party ${p + 1}`,
      members: party.members.map((member, m) => ({ slot: getSceneSlot(p, m), key: member.key, count: member.count, player: getScenePlayer(s, preset, p, m) })),
    })),
    playBar: getPlaySceneBar(state, id),
  }
}

// Every scene waiting to be played, met by an event or loaded by the table.
export function getWaitingScenes(state: CampaignState): WaitingSceneView[] {
  return Object.entries(state.scenes).map(([id, s]) => getWaitingSceneView(state, id, s))
}
