import type { CombatState, Coord, ExtinguishAction, TerrainCell } from '../types'
import { parseCoordKey, sameCell, setDistance } from '../geometry'
import { getPlacedFootprint } from './board'
import { getCellHazard, isLayerLive } from './hazard'

// combat.tex "Fire": "Both muffling and throwing water require 4 AP by
// default and being in a burning space or adjacent to it."

const REACH = 1

// Every burning space the actor stands in or is next to.
export function getExtinguishCells(state: CombatState, actorId: string): Coord[] {
  const footprint = getPlacedFootprint(state, actorId)
  if (!state.board || !footprint) return []
  return Object.keys(state.board.terrain).flatMap((key) => {
    const cell = parseCoordKey(key)
    return cell && getCellHazard(state, cell).fire > 0 && setDistance([cell], footprint) <= REACH ? [cell] : []
  })
}

export function isExtinguishCell(state: CombatState, action: ExtinguishAction): boolean {
  const { to } = action
  return to !== null && getExtinguishCells(state, action.actorId).some((c) => sameCell(c, to))
}

// A space with its fire put out: what burned is gone, and the gas or smoke the
// same layer left stays.
export function extinguishCell(state: CombatState, cell: TerrainCell): TerrainCell {
  const out = (l: TerrainCell['layers'][number]) => isLayerLive(state, l) && l.fire > 0
  const layers = cell.layers.flatMap((l) => (!out(l) ? [l] : l.suffocating || l.visibility !== null ? [{ ...l, fire: 0, fuel: null }] : []))
  return { ...cell, layers }
}
