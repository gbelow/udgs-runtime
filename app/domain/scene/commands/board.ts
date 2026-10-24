import { isCombatStarted } from '../rules/started'
import type { TerrainBrush } from '../../types'
import { BoardSchema, PlacementSchema, TerrainCellSchema, type SceneState, type Coord, type LightLevel, type MoveAction, type Updater } from '../types'
import { makeBoard, makeBoardMap } from '../factories'
import { coordKey, directionTo, distance, sameCell, turn } from '../rules/board/geometry'
import { getOpenAction } from '../rules/log'
import { isOffGrid } from '../rules/parked'
import { getPendingGuardStep } from '../rules/protect'
import { getAim } from '../rules/aim'
import { CLIMB_EASY_DL, COVER_START_RES, SWIM_DEFAULT_DL } from '../../tables'
import { placeAt, withPlacements } from '../rules/board/board'
import { getEvasiveJumpPlacements, type ReachableCell } from '../rules/move'
import { getReachableCells } from '../rules/board/reach'
import { canStandAt } from '../rules/board/ground'
import { getMoveOrigin } from '../rules/board/waypoint'
import { aimAtCell, amendAction, amendReaction, declareReaction } from './action'
import { aimExplosion } from './choices'
import { getDragReach, getWalkerPlacement } from '../rules/drag'

// The simulation tool's own commands: what the table does to the board by
// hand, outside any action. Placing and painting are refused while an action
// is open, so a fight in progress cannot have its ground changed under it.

// A fresh, empty board of the given radius, everyone unplaced.
export function createBoard(radius: number): Updater {
  return (state) => (state.board ? state : { ...state, board: BoardSchema.parse({ radius }) })
}

// Takes the board away: the fight goes on with no grid, everyone in reach,
// and what lay on the floor lies nowhere in particular. Refused while an
// action is open, as painting is.
export const removeBoard: Updater = (state) =>
  !state.board || getOpenAction(state) ? state : { ...state, board: null, floor: state.floor.map((f) => ({ ...f, cell: null })) }

// combat.tex "Darkness and light": sets the light everywhere no light
// source reaches. Refused while an action is open, as painting is.
export function setLight(light: LightLevel): Updater {
  return (state) => (!state.board || getOpenAction(state) ? state : { ...state, board: { ...state.board, light } })
}

// Takes a board in from outside — a VTT's snapshot, a saved one — through the
// same best-effort reading every board gets, replacing whatever was there.
// Refused while an action is open, for the same reason painting is.
export function importBoard(raw: unknown): Updater {
  return (state) => (getOpenAction(state) ? state : { ...state, board: makeBoard(raw) })
}

// Plays the fight on a kept board: its ground and light, everyone off it and
// what lay on the floor lying nowhere in particular. Refused while an action
// is open, as painting is.
export function loadBoardMap(raw: unknown): Updater {
  return (state) => getOpenAction(state)
    ? state
    : { ...state, board: { ...makeBoard(makeBoardMap(raw)), placements: {} }, floor: state.floor.map((f) => ({ ...f, cell: null })) }
}

// Puts a character down where the table says, at the height of the ground
// there: anywhere until the fight has started, then only a character not yet
// on the board. Placement by hand, not a move: it costs nothing and follows
// no path, and only the footprint's own rules apply. Once the fight is under
// way, a character on the board is moved by a move, or by the GM
// (`repositionCharacter`).
export function placeCharacter(id: string, cell: Coord): Updater {
  return (state) => (state.board?.placements[id] && isCombatStarted(state) ? state : repositionCharacter(id, cell)(state))
}

// The GM's hand: puts a character down anywhere, as they are oriented,
// placed before or not; never one running in a chase or parked, who are off
// the grid.
export function repositionCharacter(id: string, cell: Coord): Updater {
  return (state) => {
    if (!state.board || !state.characters[id] || getOpenAction(state) || isOffGrid(state, id)) return state
    const placement = placeAt(state.board, state.board.placements[id] ?? PlacementSchema.parse({}), cell)
    if (!canStandAt(state, id, placement)) return state
    return withPlacements(state, { [id]: placement })
  }
}

// The GM's hand: turns a standing character one step clockwise, if the
// footprint fits.
export function turnCharacter(id: string): Updater {
  return (state) => {
    const current = state.board?.placements[id]
    if (!state.board || !current || getOpenAction(state)) return state
    const placement = { ...current, orientation: turn(current.orientation) }
    if (!canStandAt(state, id, placement)) return state
    return withPlacements(state, { [id]: placement })
  }
}

// Paints one cell. `glass` toggles a wall that is seen through but stops
// what is shot or thrown, and `sturdier` and `flimsier` step the RES of the
// wall in the cell (combat.tex "Damage absorption"), from a wall nothing
// breaks. `raise` and `lower` step the elevation a metre (combat.tex
// "High Ground"), `soft` toggles ground that halves a fall (combat.tex "Fall
// damage"), `deepen` and `shoal` the depth of its water and `harder` and
// `easier` the DL of its balance or swimming test (combat.tex "Balance",
// "Swimming"), `grip` and `slip` the DL of climbing its face, starting from an
// easy climb, and `bare` leaves it nothing to hold (combat.tex "Climbing");
// `dim` and `fog` toggle bad and zero visibility (combat.tex "Visibility"),
// `louder` and `quieter` step its noise (combat.tex "Actions in stealth"); the others set what the cell is, and `clear` returns it to
// open ground by forgetting it, putting out whatever burns or hangs there.
export function paintTerrain(cell: Coord, brush: TerrainBrush): Updater {
  return (state) => {
    if (!state.board || getOpenAction(state)) return state
    const key = coordKey(cell)
    const { [key]: current = TerrainCellSchema.parse({}), ...rest } = state.board.terrain
    const painted = (() => {
      switch (brush) {
        case 'wall': return { ...current, blocking: !current.blocking, transparent: false, liquid: false, difficult: false }
        case 'glass': {
          const glass = current.blocking && current.transparent
          return { ...current, blocking: !glass, transparent: !glass, liquid: false, difficult: false }
        }
        case 'sturdier': return { ...current, RES: current.RES === null ? null : current.RES + 5 }
        case 'flimsier': return { ...current, RES: current.RES === null ? COVER_START_RES : Math.max(5, current.RES - 5) }
        case 'water': return { ...current, liquid: !current.liquid, blocking: false, difficult: false, DL: current.liquid ? current.DL : SWIM_DEFAULT_DL }
        case 'rough': return { ...current, difficult: !current.difficult, blocking: false, liquid: false }
        case 'soft': return { ...current, soft: !current.soft }
        case 'raise': return { ...current, elevation: current.elevation + 1 }
        case 'lower': return { ...current, elevation: current.elevation - 1 }
        case 'deepen': return { ...current, depth: current.depth + 1 }
        case 'shoal': return { ...current, depth: Math.max(0, current.depth - 1) }
        case 'harder': return { ...current, DL: current.DL + 1 }
        case 'easier': return { ...current, DL: current.DL - 1 }
        case 'grip': return { ...current, climbDL: current.climbDL === null ? CLIMB_EASY_DL : current.climbDL + 1 }
        case 'slip': return { ...current, climbDL: current.climbDL === null ? CLIMB_EASY_DL : current.climbDL - 1 }
        case 'bare': return { ...current, climbDL: null }
        case 'dim': return { ...current, visibility: current.visibility === 'bad' ? 'good' as const : 'bad' as const }
        case 'fog': return { ...current, visibility: current.visibility === 'zero' ? 'good' as const : 'zero' as const }
        case 'dark': return { ...current, dark: !current.dark }
        case 'louder': return { ...current, noise: current.noise + 1 }
        case 'quieter': return { ...current, noise: Math.max(0, current.noise - 1) }
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
  return (state) => readPick(state, cell, newId)?.apply(state) ?? state
}

const unchanged: Updater = (s) => s

// The pick `pickCell` makes, and whom it is made for: the open action's
// actor, but for the step a guard takes and the landing of an evasive jump,
// which are the guard's and the jumper's. Null with nothing open.
export function readPick(state: SceneState, cell: Coord, newId: () => string): { actor: string, apply: Updater } | null {
  const open = getOpenAction(state)
  if (!open) return null
  const own = (apply: Updater) => ({ actor: open.actorId, apply })
  if (open.kind === 'move' && open.step === 'define') {
    const path = pickPathCell(state, open, cell)
    return own(path ? amendAction({ path }) : unchanged)
  }
  const aim = getAim(state, open)
  if (aim) {
    return own(aim.cells.some((c) => sameCell(c, cell)) ? (aim.field === 'center' ? amendAction({ center: cell }) : aim.field === 'cell' ? aimAtCell(cell) : amendAction({ to: cell })) : unchanged)
  }
  if (open.kind === 'blast' && open.step === 'post') {
    const from = state.board?.placements[open.actorId]
    return own(from && !sameCell(from.cell, cell) ? aimExplosion(directionTo(from.cell, cell)) : unchanged)
  }
  if (open.kind === 'drag' && open.step === 'define') {
    const path = pickWayCell(getWalkerPlacement(state, open)?.cell ?? null, open.path, getDragReach(state, open), cell)
    return own(path ? amendAction({ path }) : unchanged)
  }
  const guard = open.kind === 'strike' && open.step === 'react' ? getPendingGuardStep(state, open) : null
  if (guard) {
    const to = guard.steps.find((p) => sameCell(p.cell, cell))
    return { actor: guard.reaction.actorId, apply: to ? amendReaction(guard.reaction.actorId, { to }) : unchanged }
  }
  if (open.kind === 'strike' && open.step === 'react' && open.targetId) {
    const to = getEvasiveJumpPlacements(state, open.targetId, open.actorId).find((p) => sameCell(p.cell, cell))
    return { actor: open.targetId, apply: to ? declareReaction(open.targetId, { kind: 'evasiveJump', to }, newId) : unchanged }
  }
  return own(unchanged)
}

// The path a click on a cell turns the declared one into: the cell taken
// back if it is the path's end, one more step if it is next to the end,
// the shortest way there if it is reachable at all, and nothing otherwise.
function pickPathCell(state: SceneState, action: MoveAction, cell: Coord): Coord[] | null {
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
