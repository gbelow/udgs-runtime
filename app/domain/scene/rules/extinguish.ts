import type { SceneState, Coord, ExtinguishAction, TerrainCell } from '../types'
import { coordKey, disk, sameCell, setDistance } from './board/geometry'
import { getPlacedFootprint } from './board/board'
import { getCellHazard, isLayerLive } from './board/hazard'

// combat.tex "Fire": "Both muffling and throwing water require 4 AP by
// default and being in a burning space or adjacent to it."

const REACH = 1

// Every burning space the actor stands in or is next to, on the floor their
// feet are on.
export function getExtinguishCells(state: SceneState, actorId: string): Coord[] {
  const footprint = getPlacedFootprint(state, actorId)
  const feet = state.board?.placements[actorId]?.elevation
  if (!state.board || !footprint) return []
  const near = new Map(footprint.flatMap((at) => disk(at, REACH)).map((cell) => [coordKey(cell), cell]))
  return [...near.values()].filter((cell) => getCellHazard(state, cell, feet).fire > 0 && setDistance([cell], footprint) <= REACH)
}

export function isExtinguishCell(state: SceneState, action: ExtinguishAction): boolean {
  const { to } = action
  return to !== null && getExtinguishCells(state, action.actorId).some((c) => sameCell(c, to))
}

// A space with its fire put out: what burned is gone, and the gas or smoke the
// same layer left stays.
export function extinguishCell(state: SceneState, cell: TerrainCell): TerrainCell {
  const out = (l: TerrainCell['layers'][number]) => isLayerLive(state, l) && l.fire > 0
  const layers = cell.layers.flatMap((l) => (!out(l) ? [l] : l.suffocating || l.visibility !== null ? [{ ...l, fire: 0, fuel: null }] : []))
  return { ...cell, layers }
}
