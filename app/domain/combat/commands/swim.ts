import { SWIM_ARMOR_SINK } from '../../tables'
import { isMetalArmored } from '../../character/rules/armor'
import type { Updater } from '../types'
import { clampDepth, getDepth, getWaterOf } from '../rules/swim'

// combat.tex "Swimming": the swimmer goes `metres` deeper, no deeper than the
// floor of the water they are in.
export function sink(id: string, metres: number): Updater {
  return (state) => {
    const placement = state.board?.placements[id]
    if (!state.board || !placement) return state
    const depth = clampDepth(getWaterOf(state, id), getDepth(state, id) + metres)
    return { ...state, board: { ...state.board, placements: { ...state.board.placements, [id]: { ...placement, depth } } } }
  }
}

// gear.tex "Metallic armors": they "cause the character to sink 1m per turn
// while swimming, on top of whatever they get in their swimming test".
export function sinkInArmor(id: string): Updater {
  return (state) => {
    const c = state.characters[id]
    return c && isMetalArmored(c) && getWaterOf(state, id) !== null ? sink(id, SWIM_ARMOR_SINK)(state) : state
  }
}
