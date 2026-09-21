import type { TerrainBrush } from '../../types'
import { BoardSchema, TerrainCellSchema, type Coord, type CombatState } from '../types'
import { makeBoard } from '../factories'
import { coordKey, sameCell } from '../geometry'
import { getOpenAction } from '../lenses/action'
import { canStandAt, getEvasiveJumpPlacements, pickPathCell } from '../lenses/move'
import { declareReaction } from './action'

// The simulation tool's own commands: what the table does to the board by
// hand, outside any action. Placing and painting are refused while an action
// is open, so a fight in progress cannot have its ground changed under it.

type Updater = (state: CombatState) => CombatState

// A fresh, empty board of the given radius, everyone unplaced.
export function createBoard(radius: number): Updater {
  return (state) => (state.board ? state : { ...state, board: BoardSchema.parse({ radius }) })
}

// Takes a board in from outside — a VTT's snapshot, a saved one — through the
// same best-effort reading every board gets, replacing whatever was there.
// Refused while an action is open, for the same reason painting is.
export function importBoard(raw: unknown): Updater {
  return (state) => (getOpenAction(state) ? state : { ...state, board: makeBoard(raw) })
}

// Puts a character down where the table says, as they are oriented, at the
// height of the ground there. Placement by hand, not a move: it costs
// nothing and follows no path, and only the footprint's own rules apply.
export function placeCharacter(id: string, cell: Coord): Updater {
  return (state) => {
    if (!state.board || !state.characters[id] || getOpenAction(state)) return state
    const current = state.board.placements[id]
    const placement = {
      cell,
      orientation: current?.orientation ?? 0,
      elevation: state.board.terrain[coordKey(cell)]?.elevation ?? 0,
      focus: current?.focus ?? null,
    }
    if (!canStandAt(state, id, placement)) return state
    return { ...state, board: { ...state.board, placements: { ...state.board.placements, [id]: placement } } }
  }
}

// Turns a standing character one step clockwise, if the footprint fits.
export function turnCharacter(id: string): Updater {
  return (state) => {
    const current = state.board?.placements[id]
    if (!state.board || !current || getOpenAction(state)) return state
    const placement = { ...current, orientation: (current.orientation + 1) % 6 }
    if (!canStandAt(state, id, placement)) return state
    return { ...state, board: { ...state.board, placements: { ...state.board.placements, [id]: placement } } }
  }
}

// Paints one cell. `raise` and `lower` step the elevation a metre (combat.tex
// "High Ground"); the others set what the cell is, and `clear` returns it to
// open ground by forgetting it.
export function paintTerrain(cell: Coord, brush: TerrainBrush): Updater {
  return (state) => {
    if (!state.board || getOpenAction(state)) return state
    const key = coordKey(cell)
    const { [key]: current = TerrainCellSchema.parse({}), ...rest } = state.board.terrain
    const painted = (() => {
      switch (brush) {
        case 'wall': return { ...current, blocking: !current.blocking, liquid: false, difficult: false }
        case 'water': return { ...current, liquid: !current.liquid, blocking: false, difficult: false }
        case 'rough': return { ...current, difficult: !current.difficult, blocking: false, liquid: false }
        case 'raise': return { ...current, elevation: current.elevation + 1 }
        case 'lower': return { ...current, elevation: current.elevation - 1 }
        case 'clear': return null
      }
    })()
    return { ...state, board: { ...state.board, terrain: painted ? { ...rest, [key]: painted } : rest } }
  }
}

// A click on a cell while an action is open: edits the path of a move being
// declared, or, against a committed strike, names where the target's
// evasive jump lands (combat.tex "Evasive Jump") — declaring the jump if it
// has not been.
export function pickCell(cell: Coord, newId: () => string = () => `${Date.now()}`): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open) return state
    if (open.kind === 'move' && open.status === 'declared') {
      const path = pickPathCell(state, open, cell)
      if (!path) return state
      return { ...state, actions: state.actions.map((a) => (a.id === open.id ? { ...a, path } : a)) }
    }
    if (open.kind === 'strike' && open.status === 'committed' && open.targetId) {
      const to = getEvasiveJumpPlacements(state, open.targetId, open.actorId).find((p) => sameCell(p.cell, cell))
      return to ? declareReaction(open.targetId, { kind: 'evasiveJump', to }, newId)(state) : state
    }
    return state
  }
}

// Turns the open move's ending one step clockwise from where it stands now.
export function turnMove(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    const from = open ? state.board?.placements[open.actorId] : undefined
    if (!open || open.kind !== 'move' || open.status !== 'declared' || !from) return state
    const orientation = ((open.orientation ?? from.orientation) + 1) % 6
    return { ...state, actions: state.actions.map((a) => (a.id === open.id ? { ...a, orientation } : a)) }
  }
}
