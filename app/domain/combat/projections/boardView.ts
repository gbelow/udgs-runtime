import type { CombatState, Coord, Degree, Placement } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import { coordKey, disk, parseCoordKey, sameCell, toPlane } from '../geometry'
import { getFootprint, getOccupancy } from '../rules/board'
import { findOption } from '../rules/options'
import { getDeclaredTargets } from '../rules/action'
import { findOpenRoot, getOpenAction, getReactionsTo } from '../rules/log'
import { getPendingGuardStep } from '../rules/protect'
import { getRole, type Role } from './roster'
import { getFightName } from '../rules/fighters'
import { getBlastOf, getExplosionZones, getImpactBlast, getThreatenedCells, isAimable } from '../rules/explosion'
import { getAim } from '../rules/aim'
import { getEvasiveJumpPlacements, getMoveCost, getReachableCells } from '../rules/move'
import { getDragFacts, getDragReach, getGroupSteps } from '../rules/drag'
import { canPickUp, getReachableFloor } from '../rules/floor'
import { getGrapples, getPartner, holds } from '../rules/partners'
import { perState } from './perState'
import { getCellHazard } from '../rules/hazard'

// The board as the simulation tool draws it: every cell with what is on it
// and what a click there would mean, every placed character with the cells
// it covers, and the plane coordinates of all of it — pointy-top hexes of
// unit spacing, so the panel only has to translate and scale.

export type CellTerrain = 'open' | 'wall' | 'water' | 'rough'

export type BoardCellView = {
  key: string
  cell: Coord
  x: number
  y: number
  terrain: CellTerrain
  elevation: number
  elevationLabel: string
  // what is left on the ground here (combat.tex "Fire", "Gas"): the burn of
  // a fire surface, 0 for none, and a gas that suffocates
  fire: number
  suffocating: boolean
  occupants: string[]
  // what the open move could reach here, if this cell is in its reach
  reachable: { steps: number; cost: ActionCost } | null
  // this cell's place on the path of the move in play, counted from 1; null
  // off it
  pathStep: number | null
  isDestination: boolean
  // where the target of the open strike could land an evasive jump, and the
  // landing it has picked
  jump: boolean
  isJumpTo: boolean
  // where a block or intercept against the open strike may step first
  // (abilities.tex "Defender", "Defensive Advance"), while its step is
  // still to be picked
  step: boolean
  // the explosion in play: where it may be aimed, where it is aimed, what
  // it may still reach, and the degree of effect where it goes off
  center: boolean
  isCenter: boolean
  threatened: boolean
  zone: Degree | null
  // what lies on the floor here
  items: string[]
}

export type BoardTokenView = {
  id: string
  name: string
  x: number
  y: number
  cells: { key: string; x: number; y: number }[]
  elevation: number
  orientation: number
  isActive: boolean
  isInTurn: boolean
  role: Role | null
  targetable: boolean
}

// Something lying on a cell, drawn over whoever stands there, and whether a
// click on it would pick it up: the active character with nothing open, or
// the one whose pick up is being declared, reaching it with a free hand.
// `x`/`y` put it at its cell's corner, items sharing a cell stacked
// downwards.
export type BoardFloorItemView = {
  itemId: string
  name: string
  x: number
  y: number
  pickable: boolean
}

// A grapple pair, drawn as a link between the two tokens: `from`/`to` are
// its ends at the rims of the two tokens, `forward` whether the first holds
// the second and `back` the reverse (combat.tex "Grapple"). `title` says it
// in words.
export type BoardGrappleView = {
  key: string
  from: { x: number; y: number }
  to: { x: number; y: number }
  forward: boolean
  back: boolean
  title: string
}

export type BoardGhostView = {
  id: string
  name: string
  x: number
  y: number
  cells: { key: string; x: number; y: number }[]
}

// What a click on a cell does right now.
export type BoardMode = 'idle' | 'path' | 'jump' | 'aim' | 'locked'

export type BoardView = {
  present: boolean
  radius: number
  // the SVG viewBox that frames every cell, with a margin
  viewBox: string
  // one hexagon's corners around its centre, as an SVG `points` string
  hex: string
  cells: BoardCellView[]
  tokens: BoardTokenView[]
  floor: BoardFloorItemView[]
  grapples: BoardGrappleView[]
  // combat.tex "Push and drag": where everyone a push moves will stand once
  // it lands, drawn over the board before it does
  ghosts: BoardGhostView[]
  // who a click on a pickable floor item picks it up for
  picker: string | null
  // characters in the fight with no place on the board yet
  unplaced: { id: string; name: string }[]
  mode: BoardMode
  // the open move, if one is being declared: its actor and orientation
  move: { actorId: string; orientation: number; canTurn: boolean } | null
}

const EMPTY: BoardView = { present: false, radius: 0, viewBox: '0 0 1 1', hex: '', cells: [], tokens: [], floor: [], grapples: [], ghosts: [], picker: null, unplaced: [], mode: 'locked', move: null }

const HEX = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30)
  return `${(Math.cos(angle)).toFixed(4)},${(Math.sin(angle)).toFixed(4)}`
}).join(' ')

function buildBoardView(state: CombatState): BoardView {
  const board = state.board
  if (!board) return { ...EMPTY, unplaced: Object.values(state.characters).map((c) => ({ id: c.id, name: getFightName(state, c.id) })) }

  const open = getOpenAction(state)
  // the move in play, whatever its phase: its path stays drawn throughout;
  // so does the way a push takes its block (combat.tex "Push and drag")
  const walking = findOpenRoot(state, 'drag')
  const pending = findOpenRoot(state, 'move') ?? walking
  const move = open?.kind === 'move' && open.step === 'define' ? open : null
  const group = open?.kind === 'drag' && open.step === 'define' ? open : null
  const pusher = group ? state.characters[group.actorId] : undefined
  const targets = new Set(getDeclaredTargets(state, open))
  const occupancy = getOccupancy(board, state.characters)
  const reachable = move ? getReachableCells(state, move)
    : group && pusher ? getDragReach(state, group).map((r) => ({ ...r, cost: getMoveCost(pusher, group.movement, r.steps) }))
    : []
  const reachableByKey = new Map(reachable.map((r) => [coordKey(r.cell), r]))
  const pathByKey = new Map((pending?.path ?? []).map((cell, i) => [coordKey(cell), i + 1]))
  const destination = pending?.path[pending.path.length - 1] ?? null

  // the landings open to the target of a committed strike, while the jump
  // is still theirs to declare
  const jumper = open?.kind === 'strike' && open.step === 'react' && open.targetId && findOption(state, open.targetId, { kind: 'evasiveJump' })?.available ? open.targetId : null
  const landings = new Set(jumper && open ? getEvasiveJumpPlacements(state, jumper, open.actorId).map((p) => coordKey(p.cell)) : [])
  const jump = open && jumper ? getReactionsTo(state, open.id).find((r) => r.actorId === jumper && r.kind === 'evasiveJump') : undefined
  const jumpTo = jump?.kind === 'evasiveJump' ? jump.to?.cell ?? null : null
  const guard = open?.kind === 'strike' && open.step === 'react' ? getPendingGuardStep(state, open) : null
  const steps = new Set(guard ? guard.steps.map((p) => coordKey(p.cell)) : [])

  // the explosion in play: the centres it may be aimed at, what it
  // threatens, and its zones once it is pointed. It stays aimable for as
  // long as it can be re-aimed — a disk until its actor commits, a spray
  // until the blast is confirmed (combat.tex "Sprays": the direction is
  // chosen after the movement). A throw being declared is aimed at where it
  // may land, and shows the area it would go off over there.
  const explosion = findOpenRoot(state, 'explosion')
  const blast = findOpenRoot(state, 'blast')
  const throwing = open?.kind === 'throw' && open.step === 'define' ? open : null
  const laid = blast ?? (explosion ? getBlastOf(state, explosion) : throwing ? getImpactBlast(state, throwing) : null)
  const aim = getAim(state, open)
  const aiming = (blast !== null && isAimable(state, blast)) || aim !== null
  const aimedAt = laid?.center ?? throwing?.to ?? null
  // combat.tex "Push and drag": where everyone the block moves ends up,
  // shown until it is walked
  const landed: Record<string, Placement> = walking ? (walking.step === 'post' ? getDragFacts(state, walking).to : getGroupSteps(state, walking)?.at(-1) ?? {}) : {}
  const ghosts: BoardGhostView[] = Object.entries(landed).flatMap(([id, placement]) => {
    const c = state.characters[id]
    if (!c) return []
    return [{ id, name: getFightName(state, id), ...toPlane(placement.cell), cells: getFootprint(c, placement).map((cell) => ({ key: coordKey(cell), ...toPlane(cell) })) }]
  })
  const centers = new Set(aim ? aim.cells.map(coordKey) : [])
  const threatened = new Set(laid ? getThreatenedCells(state, laid).map(coordKey) : [])
  const zones = new Map(laid ? getExplosionZones(state, laid).map((z) => [coordKey(z.cell), z.degree]) : [])

  // The drawn extent: the disk of the board's radius, plus anything placed,
  // painted or threatened beyond it.
  const extent = new Map(disk(board.origin, board.radius).map((c) => [coordKey(c), c]))
  for (const key of [...Object.keys(board.terrain), ...Object.keys(occupancy), ...threatened]) {
    const cell = parseCoordKey(key)
    if (cell && !extent.has(key)) extent.set(key, cell)
  }

  const cells: BoardCellView[] = [...extent.values()].map((cell) => {
    const key = coordKey(cell)
    const terrain = board.terrain[key]
    const { x, y } = toPlane(cell)
    const there = reachableByKey.get(key)
    const hazard = getCellHazard(state, cell)
    return {
      key,
      cell,
      x,
      y,
      terrain: terrain?.blocking ? 'wall' : terrain?.liquid ? 'water' : terrain?.difficult ? 'rough' : 'open',
      elevation: terrain?.elevation ?? 0,
      elevationLabel: elevationLabel(terrain?.elevation ?? 0),
      fire: hazard.fire,
      suffocating: hazard.suffocating,
      occupants: occupancy[key] ?? [],
      reachable: there ? { steps: there.steps, cost: there.cost } : null,
      pathStep: pathByKey.get(key) ?? null,
      isDestination: destination !== null && sameCell(destination, cell),
      jump: landings.has(key),
      isJumpTo: jumpTo !== null && sameCell(jumpTo, cell),
      step: steps.has(key),
      center: centers.has(key),
      isCenter: aimedAt !== null && sameCell(aimedAt, cell),
      threatened: threatened.has(key),
      zone: zones.get(key) ?? null,
      items: state.floor.filter((f) => f.cell !== null && sameCell(f.cell, cell)).map((f) => f.item.name),
    }
  })

  const tokens: BoardTokenView[] = Object.entries(board.placements).flatMap(([id, placement]) => {
    const c = state.characters[id]
    if (!c) return []
    const footprint = getFootprint(c, placement).map((cell) => ({ key: coordKey(cell), ...toPlane(cell) }))
    const anchor = toPlane(placement.cell)
    return [{
      id,
      name: getFightName(state, id),
      x: anchor.x,
      y: anchor.y,
      cells: footprint,
      elevation: placement.elevation,
      orientation: placement.orientation,
      isActive: id === state.activeCharacterId,
      isInTurn: id === state.inTurnCharacter,
      role: open ? getRole(state, open, id) : null,
      targetable: targets.has(id),
    }]
  })

  const picker = open?.kind === 'pickUp' && open.step === 'define' ? open.actorId
    : !open && state.activeCharacterId && findOption(state, state.activeCharacterId, { kind: 'pickUp' })?.available ? state.activeCharacterId
    : null
  const pickerCharacter = picker ? state.characters[picker] : undefined
  const pickable = new Set(pickerCharacter ? getReachableFloor(state, pickerCharacter.id).filter((f) => canPickUp(pickerCharacter, f.item)).map((f) => f.item.id) : [])
  const stacks = new Map<string, number>()
  const floor: BoardFloorItemView[] = state.floor.flatMap((f) => {
    if (!f.cell) return []
    const key = coordKey(f.cell)
    const stack = stacks.get(key) ?? 0
    stacks.set(key, stack + 1)
    const { x, y } = toPlane(f.cell)
    return [{ itemId: f.item.id, name: f.item.name, x: x + 0.55, y: y - 0.5 + stack * 0.36, pickable: pickable.has(f.item.id) }]
  })

  const grapples: BoardGrappleView[] = getGrapples(state).flatMap((g) => {
    const [a, b] = g.members
    const pa = board.placements[a]
    const pb = board.placements[b]
    if (!pa || !pb) return []
    const title = g.members.flatMap((id) => (holds(g, id) ? [`${getFightName(state, id)} holds ${getFightName(state, getPartner(g, id))}`] : [])).join(' · ')
    return [{ key: `${a}~${b}`, ...rimToRim(toPlane(pa.cell), toPlane(pb.cell)), forward: holds(g, a), back: holds(g, b), title }]
  })

  const xs = cells.map((c) => c.x)
  const ys = cells.map((c) => c.y)
  const minX = Math.min(...xs) - 1
  const minY = Math.min(...ys) - 1
  const width = Math.max(...xs) + 1 - minX
  const height = Math.max(...ys) + 1 - minY

  const mover = move ? board.placements[move.actorId] : undefined
  return {
    present: true,
    radius: board.radius,
    viewBox: `${minX.toFixed(3)} ${minY.toFixed(3)} ${width.toFixed(3)} ${height.toFixed(3)}`,
    hex: HEX,
    cells,
    tokens,
    floor,
    grapples,
    ghosts,
    picker: pickable.size > 0 ? picker : null,
    unplaced: Object.values(state.characters).filter((c) => !board.placements[c.id]).map((c) => ({ id: c.id, name: getFightName(state, c.id) })),
    mode: move || group ? 'path' : landings.size > 0 ? 'jump' : aiming ? 'aim' : open ? 'locked' : 'idle',
    move: move && mover
      ? { actorId: move.actorId, orientation: move.orientation ?? mover.orientation, canTurn: getFootprint(state.characters[move.actorId], mover).length > 1 }
      : null,
  }
}

export const getBoardView = perState(buildBoardView)

// The segment between two token centres that lies outside both tokens'
// circles; the centres themselves when the tokens overlap.
const TOKEN_RIM = 0.66

function rimToRim(from: { x: number; y: number }, to: { x: number; y: number }): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length <= 2 * TOKEN_RIM) return { from, to }
  const ux = (to.x - from.x) / length
  const uy = (to.y - from.y) / length
  return { from: { x: from.x + ux * TOKEN_RIM, y: from.y + uy * TOKEN_RIM }, to: { x: to.x - ux * TOKEN_RIM, y: to.y - uy * TOKEN_RIM } }
}

function elevationLabel(elevation: number): string {
  return elevation > 0 ? `+${elevation}` : elevation < 0 ? `${elevation}` : ''
}

export const getBoardViewDigest = perState((state) => JSON.stringify(getBoardView(state)))
