import { CampaignStateSchema, type ScenePreset } from '../../campaign/types'
import { getPresetCast, getScenePartyId } from '../../campaign/rules/scenes'
import type { CharacterOwners } from '../../profiles'
import { DEMO_BOT, DEMO_SCENE, DEMO_VISITOR } from '../../demo'
import { SceneStateSchema, type SceneState, type Table } from '../types'
import { extentCells } from '../rules/board/geometry'
import { getSpawnArea, getSpawnCells } from '../rules/board/spawn'
import { loadBoardMap, placeCharacter } from './board'
import { bringInCast } from './episode'

// The demo's fight, who plays whom in it, and which fight party is the
// visitor's.
export type DemoTable = { table: Table; owners: CharacterOwners; party: string }

// The demo's fight, made fresh: the prepared scene played with the party
// marked for the visitor made of the catalog characters they picked
// (`picks`, by key, one each), theirs to play, and every other party the
// bot's, already standing in its spawn area. Null for a scene with no party
// for the visitor, or nobody picked.
export function playDemo(preset: ScenePreset, picks: readonly string[], board: unknown | null, sheets: Record<string, unknown>, newId: () => string): DemoTable | null {
  const visitorParty = preset.parties.findIndex((p) => p.visitor)
  if (visitorParty < 0 || picks.length === 0) return null
  const played: ScenePreset = {
    ...preset,
    parties: preset.parties.map((p, i) => (i === visitorParty
      ? { ...p, members: picks.map((key) => ({ key, count: 1, player: DEMO_VISITOR })) }
      : { ...p, members: p.members.map((m) => ({ ...m, player: DEMO_BOT })) })),
  }
  const cast = getPresetCast(DEMO_SCENE, played, (p, m) => played.parties[p].members[m].player).filter((c) => sheets[c.key])
  const fight = SceneStateSchema.parse({})
  const empty: Table = { campaign: CampaignStateSchema.parse({}), fight: board === null ? fight : loadBoardMap(board)(fight) }
  const table = bringInCast(DEMO_SCENE, played, cast, sheets, newId)(empty)
  const party = getScenePartyId(DEMO_SCENE, visitorParty)
  const deployed = cast.filter((c) => c.party !== party).reduce((s, c) => deploy(s, c.id), table.fight)
  const owners = Object.fromEntries(cast.flatMap((c) => (c.player === null ? [] : [[c.id, c.player]])))
  return { table: { ...table, fight: deployed }, owners, party }
}

// The character put down on the first cell of their spawn area they can be
// placed on, or of the board when they have none; left unplaced where no
// cell takes them.
function deploy(state: SceneState, id: string): SceneState {
  const board = state.board
  if (!board) return state
  const area = getSpawnArea(state, id)
  const cells = area === null ? extentCells(board.origin, board.extent) : getSpawnCells(state, area)
  for (const cell of cells) {
    const placed = placeCharacter(id, cell)(state)
    if (placed !== state) return placed
  }
  return state
}
