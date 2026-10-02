import type { TerrainBrush } from '../../types'
import { BoardSchema, PlacementSchema, TerrainCellSchema, type CombatState, type Coord, type MoveAction, type Updater } from '../types'
import { makeBoard } from '../factories'
import { coordKey, directionTo, distance, sameCell, turn } from '../geometry'
import { getOpenAction } from '../rules/log'
import { getPendingGuardStep } from '../rules/protect'
import { getAim } from '../rules/aim'
import { placeAt, withPlacements } from '../rules/board'
import { getEvasiveJumpPlacements, getReachableCells, type ReachableCell } from '../rules/move'
import { canStandAt } from '../rules/ground'
import { getMoveOrigin } from '../rules/waypoint'
import { amendAction, amendReaction, declareReaction } from './action'
import { aimExplosion } from './choices'
import { getDragReach, getWalkerPlacement } from '../rules/drag'

// The simulation tool's own commands: what the table does to the board by
// hand, outside any action. Placing and painting are refused while an action
// is open, so a fight in progress cannot have its ground changed under it.

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
    const placement = placeAt(state.board, state.board.placements[id] ?? PlacementSchema.parse({}), cell)
    if (!canStandAt(state, id, placement)) return state
    return withPlacements(state, { [id]: placement })
  }
}

// Turns a standing character one step clockwise, if the footprint fits.
export function turnCharacter(id: string): Updater {
  return (state) => {
    const current = state.board?.placements[id]
    if (!state.board || !current || getOpenAction(state)) return state
    const placement = { ...current, orientation: turn(current.orientation) }
    if (!canStandAt(state, id, placement)) return state
    return withPlacements(state, { [id]: placement })
  }
}

// Paints one cell. `raise` and `lower` step the elevation a metre (combat.tex
// "High Ground"); the others set what the cell is, and `clear` returns it to
// open ground by forgetting it, putting out whatever burns or hangs there.
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
// declared; aims an explosion being declared at the cell, or a rolled spray
// towards it (combat.tex "Explosions", "Sprays"); or, against a committed
// strike, names where the target's evasive jump lands (combat.tex "Evasive
// Jump") — declaring the jump if it has not been; or edits the way a
// grapple group is being moved (combat.tex "Push and drag").
export function pickCell(cell: Coord, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open) return state
    if (open.kind === 'move' && open.step === 'define') {
      const path = pickPathCell(state, open, cell)
      return path ? amendAction({ path })(state) : state
    }
    const aim = getAim(state, open)
    if (aim) {
      return aim.cells.some((c) => sameCell(c, cell)) ? amendAction(aim.field === 'center' ? { center: cell } : { to: cell })(state) : state
    }
    if (open.kind === 'blast' && open.step === 'post') {
      const from = state.board?.placements[open.actorId]
      return from && !sameCell(from.cell, cell) ? aimExplosion(directionTo(from.cell, cell))(state) : state
    }
    if (open.kind === 'drag' && open.step === 'define') {
      const path = pickWayCell(getWalkerPlacement(state, open)?.cell ?? null, open.path, getDragReach(state, open), cell)
      return path ? amendAction({ path })(state) : state
    }
    const guard = open.kind === 'strike' && open.step === 'react' ? getPendingGuardStep(state, open) : null
    if (guard) {
      const to = guard.steps.find((p) => sameCell(p.cell, cell))
      return to ? amendReaction(guard.reaction.actorId, { to })(state) : state
    }
    if (open.kind === 'strike' && open.step === 'react' && open.targetId) {
      const to = getEvasiveJumpPlacements(state, open.targetId, open.actorId).find((p) => sameCell(p.cell, cell))
      return to ? declareReaction(open.targetId, { kind: 'evasiveJump', to }, newId)(state) : state
    }
    return state
  }
}

// The path a click on a cell turns the declared one into: the cell taken
// back if it is the path's end, one more step if it is next to the end,
// the shortest way there if it is reachable at all, and nothing otherwise.
function pickPathCell(state: CombatState, action: MoveAction, cell: Coord): Coord[] | null {
  return pickWayCell(getMoveOrigin(state, action)?.cell ?? null, action.path, getReachableCells(state, action), cell)
}

function pickWayCell(from: Coord | null, path: Coord[], reachable: Pick<ReachableCell, 'cell' | 'steps' | 'path'>[], cell: Coord): Coord[] | null {
  if (!from) return null
  const end = path[path.length - 1] ?? from
  if (path.length > 0 && sameCell(end, cell)) return path.slice(0, -1)
  const there = reachable.find((r) => sameCell(r.cell, cell))
  if (!there) return null
  if (distance(end, cell) === 1 && there.steps > path.length) return [...path, cell]
  return there.path
}

// Turns the open move's ending one step clockwise from where it stands now.
export function turnMove(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    const from = open ? state.board?.placements[open.actorId] : undefined
    if (!open || open.kind !== 'move' || open.step !== 'define' || !from) return state
    return amendAction({ orientation: turn(open.orientation ?? from.orientation) })(state)
  }
}
