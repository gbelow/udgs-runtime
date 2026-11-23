import type { Coord, SceneState } from '../../types'
import { isCombatStarted } from '../started'
import { coordKey, extentCells } from './geometry'
import { getFootprint } from './board'

// The spawn areas of a prepared scene (the user's ruling, 2026-11-23): each
// party is placed by hand in the area of the battle map the scene gives it,
// until the fight starts. Once it has, nobody is placed by hand but whoever
// was never placed, and they stand where they may.

// The area the character is placed in now: their party's, while the fight
// has not started and the board has that area painted; null for anywhere.
export function getSpawnArea(state: SceneState, id: string): number | null {
  const board = state.board
  const party = state.partyOf[id]
  const area = party === undefined ? undefined : state.spawnOf[party]
  if (!board || area === undefined || isCombatStarted(state)) return null
  return Object.values(board.spawns).includes(area) ? area : null
}

// The cells of the area, in the order the board's extent lists them.
export function getSpawnCells(state: SceneState, area: number): Coord[] {
  const board = state.board
  if (!board) return []
  return extentCells(board.origin, board.extent).filter((c) => board.spawns[coordKey(c)] === area)
}

// Whether where the character stands keeps to their spawn area, if they have
// one: every cell of their footprint in it.
export function isInSpawnArea(state: SceneState, id: string): boolean {
  const area = getSpawnArea(state, id)
  const placement = state.board?.placements[id]
  const c = state.characters[id]
  if (area === null) return true
  if (!placement || !c) return false
  return getFootprint(c, placement).every((cell) => state.board?.spawns[coordKey(cell)] === area)
}
