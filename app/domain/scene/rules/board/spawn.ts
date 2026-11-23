import type { SceneState } from '../../types'
import { isCombatStarted } from '../started'
import { coordKey } from './geometry'
import { getFootprint } from './board'

// The spawn areas of a prepared scene (the user's ruling, 2026-11-23): each
// of its parties is placed by hand in the area the scene painted for it over
// its battle map, until the fight starts. A party the scene painted none for
// is placed anywhere, and once the fight has started nobody is placed by hand
// but whoever was never placed, and they stand where they may.

// The cells (by key) the character is placed in now: their party's area,
// while the fight has not started; null for anywhere.
export function getSpawnArea(state: SceneState, id: string): string[] | null {
  const party = state.partyOf[id]
  const area = party === undefined ? undefined : state.spawnOf[party]
  if (!state.board || !area || area.length === 0 || isCombatStarted(state)) return null
  return area
}

// Whether where the character stands keeps to their spawn area, if they have
// one: every cell of their footprint in it.
export function isInSpawnArea(state: SceneState, id: string): boolean {
  const area = getSpawnArea(state, id)
  const placement = state.board?.placements[id]
  const c = state.characters[id]
  if (area === null) return true
  if (!placement || !c) return false
  return getFootprint(c, placement).every((cell) => area.includes(coordKey(cell)))
}

// The parties with a spawn area while the fight has not started, in the order
// they joined it: the n-th is drawn in the n-th tint (from 1).
export function getSpawnParties(state: SceneState): string[] {
  if (!state.board || isCombatStarted(state)) return []
  return Object.keys(state.parties).filter((party) => (state.spawnOf[party]?.length ?? 0) > 0)
}
