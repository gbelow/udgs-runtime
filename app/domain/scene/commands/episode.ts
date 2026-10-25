import type { CampaignState } from '../../campaign/types'
import type { FloorItem, SceneState, Table, TableUpdater } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { getPlaySceneBar, getScenePreset } from '../../campaign/rules/scenes'
import { getPlaceKey } from '../../campaign/rules/place'
import { getRosterName } from '../../campaign/rules/roster'
import { record } from '../../campaign/commands/journal'
import { getCatalogItem } from '../../item/rules/items'
import { without } from '../../utils'
import { loadBoardMap } from './board'
import { loadIntoFight, sendToFight } from './fight'

// A prepared scene an event led to, played out: on its battle map (`board`,
// the kept map the table found under the preset's name, or null for a scene
// with no board), with whoever met it sent into the fight, the catalog
// characters it is played against (`opponents`, the sheets the table found
// by key) brought in as a party of their own, and its treasure lying on the
// floor. The fight remembers where it was met, for what is left lying there
// when it ends. Refused as `getPlaySceneBar` says.
export function playScene(sceneId: string, board: unknown | null, opponents: Record<string, unknown>, newId: () => string): TableUpdater {
  return (table) => {
    if (getPlaySceneBar(table.campaign, sceneId)) return table
    const waiting = table.campaign.scenes[sceneId]
    const preset = getScenePreset(waiting.preset)
    const names = waiting.members.map((id) => getRosterName(table.campaign, id)).join(', ')
    const campaign = record({
      kind: 'scene', party: waiting.party, title: preset.name,
      lines: [...(preset.text ? [preset.text] : []), `${waiting.event ? `from ${waiting.event}, ` : ''}played by ${names}`],
    })({ ...table.campaign, scenes: without(table.campaign.scenes, sceneId) })
    const fight = board === null ? { ...table.fight, board: null } : loadBoardMap(board)(table.fight)
    const sent = sendToFight(waiting.members.filter((id) => campaign.characters[id]))({ campaign, fight })
    const side = newId()
    const met = preset.opponents.flatMap(({ key, count }) => (opponents[key] ? Array.from({ length: count }, () => opponents[key]) : []))
    const played = met.reduce<Table>((t, raw) => loadIntoFight(makeCampaignCharacter(raw as object), newId, side)(t), sent)
    const floor: FloorItem[] = preset.treasure.flatMap(({ key, amount }) => {
      const item = getCatalogItem(key, amount)
      return item ? [{ item: { ...item, id: newId() }, cell: null, planted: null }] : []
    })
    return { ...played, fight: { ...played.fight, floor: [...played.fight.floor, ...floor], foundAt: waiting.at ? getPlaceKey(waiting.at) : null } }
  }
}

// What a fight that ended left on its floor, left where it was met.
export function leaveBehind(fight: SceneState, campaign: CampaignState): CampaignState {
  const key = fight.foundAt
  if (!key || fight.floor.length === 0) return campaign
  return { ...campaign, left: { ...campaign.left, [key]: [...(campaign.left[key] ?? []), ...fight.floor.map((f) => f.item)] } }
}
