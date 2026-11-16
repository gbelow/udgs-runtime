import type { BaseCharacter } from '../../types'
import type { BoardMap, SavedBoardMap } from '../types'
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
