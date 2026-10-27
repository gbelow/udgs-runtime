import { isCombatStarted } from '../rules/started'
import type { TerrainBrush } from '../../types'
import { BoardExtentSchema, BoardSchema, PlacementSchema, TerrainCellSchema, type BoardExtent, type GroundRecipe, type SceneState, type Coord, type LightLevel, type MoveAction, type Surface, type TerrainCell, type Updater } from '../types'
import { makeBoard, makeBoardMap } from '../factories'
import { coordKey, directionTo, disk, distance, extentCells, inExtent, sameCell, turn } from '../rules/board/geometry'
import { BRUSH_RADIUS_MOST } from '../../lists'
import { getOpenAction } from '../rules/log'
import { planGround } from '../rules/board/generate'
import { getSurface, pickArt } from '../rules/board/surface'
import { isOffGrid } from '../rules/parked'
import { getPendingGuardStep } from '../rules/protect'
import { getAim } from '../rules/aim'
import { CLIMB_EASY_DL, COVER_START_RES, SWIM_DEFAULT_DL } from '../../tables'
import { getBeyondEdge, placeAt, withPlacements, withoutPlacements } from '../rules/board/board'
import { without } from '../../utils'
import { drawsSegments, getEvasiveJumpPlacements, type ReachableCell } from '../rules/move'
import { findOpenJump } from '../rules/options'
import { getReachableCells } from '../rules/board/reach'
import { canStandAt } from '../rules/board/ground'
import { getMoveOrigin, getPathTurns, withoutLastSegment } from '../rules/board/waypoint'
import { aimAtCell, amendAction, amendReaction, declareReaction } from './action'
import { aimExplosion, displaceTrampled } from './choices'
import { getDragReach, getWalkerPlacement } from '../rules/drag'
import { getSteadyPath, isSteadyShot } from '../rules/steadyArms'

// The simulation tool's own commands: what the table does to the board by
// hand, outside any action. Placing and painting are refused while an action
// is open, so a fight in progress cannot have its ground changed under it.

// A fresh, empty board reaching `radius` along every axis, everyone unplaced.
export function createBoard(radius: number): Updater {
  return (state) => (state.board ? state : { ...state, board: BoardSchema.parse({ extent: { q: radius, r: radius, s: radius } }) })
}

// Takes the board away: the fight goes on with no grid, everyone in reach,
// and what lay on the floor lies nowhere in particular. Refused while an
// action is open, as painting is.
export const removeBoard: Updater = (state) =>
  !state.board || getOpenAction(state) ? state : { ...state, board: null, floor: state.floor.map((f) => ({ ...f, cell: null })) }

// Widens or narrows the board around its origin, along each of the three hex
// axes: whoever stands partly beyond the new edge comes off it, what lay on
// the floor out there lies nowhere in particular, and the ground painted
// there is dropped. Refused while an action is open, as painting is.
export function resizeBoard(extent: BoardExtent): Updater {
  return (state) => {
    const resized = BoardExtentSchema.safeParse(extent)
    if (!state.board || getOpenAction(state) || !resized.success) return state
    const beyond = getBeyondEdge(state, resized.data)
    const off = withoutPlacements(state, beyond.characters).board ?? state.board
    return {
      ...state,
      board: { ...off, extent: resized.data, terrain: beyond.terrain.reduce(without, off.terrain) },
      floor: state.floor.map((f) => (beyond.floor.includes(f.item.id) ? { ...f, cell: null } : f)),
    }
  }
}

// combat.tex "Darkness and light": sets the light everywhere no light
// source reaches. Refused while an action is open, as painting is.
export function setLight(light: LightLevel): Updater {
  return (state) => (!state.board || getOpenAction(state) ? state : { ...state, board: { ...state.board, light } })
}

// Sets the surface of every cell that names none, or none. Refused while an
// action is open, as painting is.
export function setSurface(surface: string | null): Updater {
  return (state) => (!state.board || (surface !== null && !getSurface(surface)) || getOpenAction(state) ? state : { ...state, board: { ...state.board, surface } })
}

// Makes one cell of a surface, overwriting every value the surface sets. A
// wall or water is not walked on, so it stays as it is: no difficult ground
// under it, and the DL of a swim is not the surface's. A surface of water
// makes its cell water, with the surface's DL for the swim, and the next
// surface laid takes that water away again; water painted by hand stays. The
// picture the cell is drawn with is the frozen one, when the surface lists it,
// else the roll's: the table's, picking one of the surface's own. A `radius`
// lays every cell within that many steps of the cell, those off the board left
// alone, each drawing its own picture from the roll.
export function laySurface(cell: Coord, name: string, roll: number, frozen: string | null, radius = 0): Updater {
  return (state) => {
    const surface = getSurface(name)
    const board = state.board
    if (!board || !surface || getOpenAction(state)) return state
    const reach = Number.isInteger(radius) ? Math.max(0, Math.min(BRUSH_RADIUS_MOST, radius)) : 0
    const cells = disk(cell, reach).filter((c) => sameCell(c, cell) || inExtent(board.origin, board.extent, c))
    const terrain = { ...board.terrain }
    cells.forEach((c, i) => {
      const key = coordKey(c)
      terrain[key] = laidCell(terrain[key] ?? TerrainCellSchema.parse({}), name, surface, pickArt(surface, roll + i, frozen)?.src ?? null)
    })
    return { ...state, board: { ...board, terrain } }
  }
}

function laidCell(current: TerrainCell, name: string, surface: Surface, art: string | null): TerrainCell {
  const liquid = !current.blocking && (surface.liquid || (current.liquid && !getSurface(current.surface ?? '')?.liquid))
  return {
    ...current,
    surface: name,
    art,
    liquid,
    difficult: !current.blocking && !liquid && surface.difficult,
    DL: liquid && !surface.liquid ? current.DL : surface.DL,
    noise: surface.noise,
    soft: surface.soft,
    visibility: surface.visibility,
  }
}

// Lays the ground a recipe makes on every cell of the board, as laying each by
// hand would, and so overwriting whatever ground they had. A recipe naming no
// surface of the catalog, or all of weight none, changes nothing. Refused while
// an action is open, as painting is.
export function generateGround(recipe: GroundRecipe, seed: number): Updater {
  return (state) => {
    if (!state.board || getOpenAction(state)) return state
    const plan = planGround(recipe, extentCells(state.board.origin, state.board.extent), seed)
    if (plan.size === 0) return state
    const terrain = { ...state.board.terrain }
    for (const [key, { surface: name, roll }] of plan) {
      const surface = getSurface(name)
      if (surface) terrain[key] = laidCell(terrain[key] ?? TerrainCellSchema.parse({}), name, surface, pickArt(surface, roll, null)?.src ?? null)
    }
    return { ...state, board: { ...state.board, terrain } }
  }
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

// The state a toggling brush sets on a cell, for the brushes that flip a flag:
// a disk is set to what the centre becomes, so that a stroke does not leave
// some cells on and others off.
const TOGGLED: Partial<Record<TerrainBrush, (cell: TerrainCell) => boolean>> = {
  wall: (c) => c.blocking,
  glass: (c) => c.blocking && c.transparent,
  water: (c) => c.liquid,
  rough: (c) => c.difficult,
  soft: (c) => c.soft,
  dim: (c) => c.visibility === 'bad',
  fog: (c) => c.visibility === 'zero',
  dark: (c) => c.dark,
}

// Paints the cell, and every cell within `radius` steps of it, as the brush does
// to each. `glass` toggles a wall that is seen through but stops
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
export function paintTerrain(cell: Coord, brush: TerrainBrush, radius = 0): Updater {
  return (state) => {
    const board = state.board
    if (!board || getOpenAction(state)) return state
    const reach = Number.isInteger(radius) ? Math.max(0, Math.min(BRUSH_RADIUS_MOST, radius)) : 0
    const cells = disk(cell, reach).filter((c) => sameCell(c, cell) || inExtent(board.origin, board.extent, c))
    const flag = TOGGLED[brush]
    const target = flag ? !flag(board.terrain[coordKey(cell)] ?? TerrainCellSchema.parse({})) : null
    const terrain = { ...board.terrain }
    for (const c of cells) {
      const key = coordKey(c)
      const current = terrain[key] ?? TerrainCellSchema.parse({})
      if (flag && flag(current) === target) continue
      const painted = paintedCell(current, brush)
      if (painted) terrain[key] = painted
      else delete terrain[key]
    }
    return { ...state, board: { ...board, terrain } }
  }
}

function paintedCell(current: TerrainCell, brush: TerrainBrush): TerrainCell | null {
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
}

// A click on a cell while an action is open: edits the path of a move being
// declared; aims an explosion being declared at the cell, or a rolled spray
// towards it (combat.tex "Explosions", "Sprays"); or, against a committed
// strike, names where the target's evasive jump lands (combat.tex "Evasive
// Jump") — declaring the jump if it has not been; or edits the way a
// grapple group is being moved (combat.tex "Push and drag"); or puts a
// defender a won crash displaces (combat.tex "Crash").
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
    const drawn = pickPathCell(state, open, cell)
    return own(drawn ? amendAction(drawn) : unchanged)
  }
  if (open.kind === 'shoot' && open.step === 'define' && isSteadyShot(open)) {
    const drawn = pickPathCell(state, getSteadyPath(state, open), cell)
    return own(drawn ? amendAction({ ...drawn, firedAt: null }) : unchanged)
  }
  const aim = getAim(state, open)
  if (aim) {
    if (!aim.cells.some((c) => sameCell(c, cell))) return own(unchanged)
    return own(aim.field === 'center' ? amendAction({ center: cell }) : aim.field === 'cell' ? aimAtCell(cell) : aim.field === 'displace' ? displaceTrampled(cell) : amendAction({ to: cell }))
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
    const offered = findOpenJump(state, open.targetId)?.draft
    const modifiers = offered?.kind === 'evasiveJump' ? offered.modifiers : undefined
    return { actor: open.targetId, apply: to ? declareReaction(open.targetId, { kind: 'evasiveJump', modifiers, to }, newId) : unchanged }
  }
  return own(unchanged)
}

// The path a click on a cell turns the declared one into: the last segment
// taken back if it is the path's end, the path cut back to the cell if it
// is on the way (all of it at the origin), and otherwise, if the move can
// reach it, the path with a segment more, the shortest way there from the
// end. A jump or a climb is one segment, which a new cell replaces.
function pickPathCell(state: SceneState, action: MoveAction, cell: Coord): { path: Coord[]; turns: number[] } | null {
  const from = getMoveOrigin(state, action)?.cell
  if (!from) return null
  const { path } = action
  const turns = getPathTurns(action)
  if (path.length > 0 && sameCell(path[path.length - 1], cell)) return withoutLastSegment(action)
  const at = [from, ...path].findLastIndex((p) => sameCell(p, cell))
  if (path.length > 0 && at >= 0) return { path: path.slice(0, at), turns }
  const there = getReachableCells(state, action).find((r) => sameCell(r.cell, cell))
  if (!there) return null
  return { path: there.path, turns: drawsSegments(action.movement) && path.length > 0 ? [...turns, path.length] : [] }
}

// Takes back the last segment of the open move's path.
export function backSegment(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.step !== 'define') return state
    if (open.kind === 'shoot' && isSteadyShot(open) && open.path.length > 0) return amendAction({ ...withoutLastSegment(getSteadyPath(state, open)), firedAt: null })(state)
    if (open.kind !== 'move' || open.path.length === 0) return state
    return amendAction(withoutLastSegment(open))(state)
  }
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
