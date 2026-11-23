import type { CampaignState, ScenePreset } from '../../campaign/types'
import type { CampaignCharacter } from '../../types'
import { isDead } from '../../character/rules/afflictions'
import { leaveForGood } from '../../campaign/commands/roster'
import type { FloorItem, SceneState, Table, TableUpdater } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { getPlaySceneBar, getSceneCast, getScenePreset, getSceneSpawns, type SceneCast } from '../../campaign/rules/scenes'
import { getPlaceKey } from '../../campaign/rules/place'
import { getRosterName } from '../../campaign/rules/roster'
import { record } from '../../campaign/commands/journal'
import { getCatalogItem } from '../../item/rules/items'
import { without } from '../../utils'
import { loadBoardMap } from './board'
import { loadIntoFight, sendToFight } from './fight'
import { createParty } from './parties'

// A prepared scene an event led to, played out: on its battle map (`board`,
// the kept map the table found under the preset's name, or null for a scene
// with no board), with whoever met it sent into the fight, each of its
// parties brought in as a fight party of its own, made of new copies of the
// catalog characters it names (`sheets`, found by key) as `getSceneCast` lays
// them out, and its treasure lying on the floor. The fight remembers where it
// was met, for what is left lying there when it ends. Refused as
// `getPlaySceneBar` says.
export function playScene(sceneId: string, board: unknown | null, sheets: Record<string, unknown>, newId: () => string): TableUpdater {
  return (table) => {
    if (getPlaySceneBar(table.campaign, sceneId)) return table
    const waiting = table.campaign.scenes[sceneId]
    const preset = getScenePreset(waiting.preset)
    const cast = getSceneCast(sceneId, waiting).filter((c) => sheets[c.key])
    const names = waiting.members.map((id) => getRosterName(table.campaign, id)).join(', ')
    const campaign = record({
      kind: 'scene', party: waiting.party || null, title: preset.name,
      lines: [...(preset.text ? [preset.text] : []), `${waiting.event ? `from ${waiting.event}, ` : ''}played by ${names}`],
    })({ ...table.campaign, scenes: without(table.campaign.scenes, sceneId) })
    const fight = board === null ? { ...table.fight, board: null } : loadBoardMap(board)(table.fight)
    const sent = sendToFight(waiting.members.filter((id) => campaign.characters[id]))({ campaign, fight })
    const played = bringInCast(sceneId, preset, cast, sheets, newId)(sent)
    return { ...played, fight: { ...played.fight, foundAt: waiting.at ? getPlaceKey(waiting.at) : null } }
  }
}

// What a preset played as `sceneId` brings into the fight: each of its
// parties as a fight party of its own, placed in its spawn area, made of the
// cast (new copies of the catalog characters in `sheets`), and its treasure
// lying on the floor.
export function bringInCast(sceneId: string, preset: ScenePreset, cast: readonly SceneCast[], sheets: Record<string, unknown>, newId: () => string): TableUpdater {
  return (table) => {
    const parties = cast.reduce<Table>((t, c) => ({ ...t, fight: createParty(c.party, c.partyName)(t.fight) }), table)
    const played = cast.reduce<Table>((t, c) => loadIntoFight({ ...makeCampaignCharacter(sheets[c.key] as object), id: c.id }, newId, c.party)(t), parties)
    const floor: FloorItem[] = preset.treasure.flatMap(({ key, amount }) => {
      const item = getCatalogItem(key, amount)
      return item ? [{ item: { ...item, id: newId() }, cell: null, planted: null }] : []
    })
    return { ...played, fight: { ...played.fight, floor: [...played.fight.floor, ...floor], spawnOf: { ...played.fight.spawnOf, ...getSceneSpawns(sceneId, preset) } } }
  }
}

// The dead stay where they fell, whole, under the place the fight was met at
// (the empty key for a fight met nowhere): they are not given back to the
// roster with their party, since carrying a body is storing it. One sent from
// the roster is gone from it for good.
export function leaveDead(fight: SceneState, campaign: CampaignState, dead: CampaignCharacter[], fromRoster: (id: string) => boolean): CampaignState {
  if (dead.length === 0) return campaign
  const key = fight.foundAt ?? ''
  const forgotten = dead.filter((c) => fromRoster(c.id)).reduce((acc, c) => leaveForGood(c.id)(acc), campaign)
  return { ...forgotten, fallen: { ...forgotten.fallen, [key]: [...(forgotten.fallen[key] ?? []), ...dead] } }
}

// What a fight that ended left on its floor, left where it was met, and the
// dead who lie there with it.
export function leaveBehind(fight: SceneState, campaign: CampaignState): CampaignState {
  const key = fight.foundAt
  const items = key && fight.floor.length > 0 ? { left: { ...campaign.left, [key]: [...(campaign.left[key] ?? []), ...fight.floor.map((f) => f.item)] } } : {}
  return leaveDead(fight, { ...campaign, ...items }, Object.values(fight.characters).filter(isDead), (id) => id in campaign.partyOf && !campaign.characters[id])
}
