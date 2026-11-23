import type { BaseCharacter } from '../../types'
import type { BoardMap, SavedBoardMap } from '../types'
import type { ScenePreset } from '../../campaign/types'
import type { BoardView } from './boardView'
import { getBoardMapView } from './boardMap'
import { getBaseCharacters } from '../../character/grouping'

// What playing a prepared scene takes from what the screen has loaded: the
// shared battle map kept under the name it gives (null, none named or none
// found, for a scene with no board), and the catalog characters it names, by
// key.
export function getSceneMaterials(scene: { board: string; keys: readonly string[] }, boardMaps: Record<string, SavedBoardMap>, characters: Record<string, unknown>): { board: BoardMap | null; sheets: Record<string, BaseCharacter> } {
  const kept = scene.board ? Object.values(boardMaps).find((b) => b.owner === null && b.map.name === scene.board) : undefined
  const sheets = Object.fromEntries(getBaseCharacters(characters).filter((c) => scene.keys.includes(c.name)).map((c) => [c.name, c]))
  return { board: kept?.map ?? null, sheets }
}

// A prepared scene's battle map as its editor draws it: the map, with each
// party's spawn area tinted as the party's place among the scene's parties
// (from 1); a cell two areas share is drawn in the first's.
export function getPresetBoardView(map: BoardMap, preset: ScenePreset): BoardView {
  const view = getBoardMapView(map)
  const marks = new Map<string, number>()
  preset.parties.forEach((p, i) => { for (const key of p.spawn) if (!marks.has(key)) marks.set(key, i + 1) })
  return { ...view, cells: view.cells.map((c) => ({ ...c, spawn: marks.get(c.key) ?? null })) }
}
