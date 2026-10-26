import type { Bind, BoardExtent, SceneState, SeenScene, Coord, Degree, LightLevel, Placement } from '../types'
import type { Fuel, Visibility } from '../../types'
import { SPELLS, isSpellKey } from '../../spells'
import type { ActionCost } from '../../character/rules/actionCosts'
import { HEX_POINTS, angleBetween, coordKey, extentCells, frameHexes, hexBounds, parseCoordKey, sameCell, toPlane } from '../rules/board/geometry'
import { getBeyondEdge, getBodyCoverToward, getFootprint, getOccupancy } from '../rules/board/board'
import { getDeclaredFloorTargets, getDeclaredTargets } from '../rules/action'
import { findOpenRoot, getOpenAction, getReactionsTo } from '../rules/log'
import { getPendingGuardStep } from '../rules/protect'
import { getRole, type Role } from './roster'
import { getFightName } from '../rules/fighters'
import { getBlastOf, getExplosionZones, getImpactBlast, getThreatenedCells } from '../rules/explosion'
import { getBoardMode, getEvasiveJumper, getFloorPicker, type BoardMode } from '../rules/board/boardMode'
import { getAim } from '../rules/aim'
import { getEvasiveJumpPlacements, getMoveCost } from '../rules/move'
import { getSteadyPath, isSteadyShot } from '../rules/steadyArms'
import { getReachableCells } from '../rules/board/reach'
import { getMoveSweep } from '../rules/board/waypoint'
import { getDepth } from '../rules/swim'
import { getDragFacts, getDragReach, getGroupSteps } from '../rules/drag'
import { getPartner, holds } from '../rules/partners'
import { perState } from '../../perState'
import { getCellFuels, getCellHazard } from '../rules/board/hazard'
import { getCellLight } from '../rules/board/light'
import { getCellArt, getSurfaceChoices, type CellArt } from '../rules/board/surface'
import { getAwaited } from '../rules/options'
import { getCellSenser } from '../rules/detection'
import { getSightOf } from '../rules/seen'
import { isOffGrid } from '../rules/parked'

// The board as the simulation tool draws it: every cell with what is on it
// and what a click there would mean, every placed character with the cells
// it covers, and the plane coordinates of all of it — pointy-top hexes of
// unit spacing, so the panel only has to translate and scale.

export type CellTerrain = 'open' | 'wall' | 'glass' | 'water' | 'rough'

export type BoardCellView = {
  key: string
  cell: Coord
  x: number
  y: number
  terrain: CellTerrain
  // combat.tex "Damage absorption": how sturdy the wall or cover in the cell
  // is, its RES or unbreakable; null for ground with neither
  strength: string | null
  elevation: number
  elevationLabel: string
  // what is left on the ground here (combat.tex "Fire", "Gas"): the burn of
  // a fire surface, 0 for none, and a gas that suffocates
  fire: number
  fuels: Fuel[]
  suffocating: boolean
  // how well the cell is seen into (combat.tex "Visibility"), null for good,
  // and the noise its ground makes per AP (combat.tex "Actions in stealth")
  visibility: Visibility | null
  noise: number
  // what the ground is made of: its name in the surfaces catalog, and the
  // texture it is drawn with; null for ground with none
  surface: string | null
  // the picture it is drawn with: its place in the board's `arts`, null for none
  art: number | null
  // combat.tex "Darkness and light": the light on the cell, and whether it
  // is a light source that makes it bright
  light: LightLevel
  lit: boolean
  // the board seen from the active character's eyes: no active sense of theirs
  // takes the cell in (`getBoardViewFrom`)
  unseen: boolean
  occupants: string[]
  // what the open move could reach here, if this cell is in its reach
  reachable: { steps: number; cost: ActionCost } | null
  // this cell's place on the path of the move in play, counted from 1; null
  // off it
  pathStep: number | null
  // the mover's token covers the cell at some step of that move, so a token
  // bigger than a cell shows every space it passes over
  swept: boolean
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
  // the picture on the token, empty for none
  image: string
  x: number
  y: number
  cells: { key: string; x: number; y: number }[]
  elevation: number
  // metres below the water's surface, 0 for one who breathes
  depth: number
  orientation: number
  isActive: boolean
  isInTurn: boolean
  role: Role | null
  targetable: boolean
  // the committed action still waits on their answer (`getAwaited`)
  awaited: boolean
  // combat.tex "Cover": in total cover behind a body shield, which faces
  // this way, in degrees; null out of it
  shieldAngle: number | null
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
  // the open strike or shot could be aimed at it
  targetable: boolean
}

// A bind between two characters, drawn as a link between the two tokens:
// `from`/`to` are its ends at the rims of the two tokens, `forward` whether the
// first holds the second and `back` the reverse (combat.tex "Grapple"; a net's
// tether, gear.tex "Net"; a held arc, spells.tex "Sustained Lightning"). `title`
// says it in words.
export type BoardBindView = {
  key: string
  kind: Bind['kind']
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
export type { BoardMode }

export type BoardView = {
  present: boolean
  extent: BoardExtent
  // the SVG viewBox that frames every cell, with a margin
  viewBox: string
  // one hexagon's corners around its centre, as an SVG `points` string
  hex: string
  // combat.tex "Darkness and light": the light where no source reaches
  light: LightLevel
  // the rectangle that frames every cell, in the units the tokens are placed in
  frame: { x: number; y: number; width: number; height: number }
  // the surface of every cell that names none, and the ones to choose from
  surface: string | null
  surfaces: { name: string; arts: string[] }[]
  // the pictures the cells are drawn with, lowest priority first (the order
  // they are drawn in), which a cell's `art` indexes
  arts: CellArt[]
  cells: BoardCellView[]
  tokens: BoardTokenView[]
  floor: BoardFloorItemView[]
  binds: BoardBindView[]
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

const EMPTY: BoardView = { present: false, extent: { q: 0, r: 0, s: 0 }, viewBox: '0 0 1 1', hex: '', light: 'bright', frame: { x: 0, y: 0, width: 1, height: 1 }, surface: null, surfaces: [], arts: [], cells: [], tokens: [], floor: [], binds: [], ghosts: [], picker: null, unplaced: [], mode: 'locked', move: null }

function buildBoardView(state: SeenScene): BoardView {
  const board = state.board
  if (!board) return { ...EMPTY, unplaced: Object.values(state.characters).filter((c) => !isOffGrid(state, c.id)).map((c) => ({ id: c.id, name: getFightName(state, c.id) })) }

  const open = getOpenAction(state)
  // the move in play, whatever its phase: its path stays drawn throughout;
  // so does the way a push takes its block (combat.tex "Push and drag")
  const walking = findOpenRoot(state, 'drag')
  // abilities.tex "Steady Arms": the careful path drawn with a shot being declared
  const steady = open?.kind === 'shoot' && open.step === 'define' && isSteadyShot(open) ? getSteadyPath(state, open) : null
  const pending = findOpenRoot(state, 'move') ?? walking ?? steady
  const move = open?.kind === 'move' && open.step === 'define' ? open : null
  const group = open?.kind === 'drag' && open.step === 'define' ? open : null
  const pusher = group ? state.characters[group.actorId] : undefined
  const targets = new Set(getDeclaredTargets(state, open))
  const occupancy = getOccupancy(board, state.characters)
  const reachable = move ? getReachableCells(state, move)
    : steady ? getReachableCells(state, steady)
    : group && pusher ? getDragReach(state, group).map((r) => ({ ...r, cost: getMoveCost(pusher, group.movement, r.steps) }))
    : []
  const reachableByKey = new Map(reachable.map((r) => [coordKey(r.cell), r]))
  const pathByKey = new Map((pending?.path ?? []).map((cell, i) => [coordKey(cell), i + 1]))
  const swept = new Set(pending?.kind === 'move' ? getMoveSweep(state, pending).flat().map(coordKey) : [])
  const destination = pending?.path[pending.path.length - 1] ?? null

  // the landings open to the target of a committed strike, while the jump
  // is still theirs to declare
  const jumper = getEvasiveJumper(state)
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

  // The drawn cells: those within the board's extent, plus anything placed,
  // painted or threatened beyond it.
  const drawn = new Map(extentCells(board.origin, board.extent).map((c) => [coordKey(c), c]))
  for (const key of [...Object.keys(board.terrain), ...Object.keys(occupancy), ...threatened]) {
    const cell = parseCoordKey(key)
    if (cell && !drawn.has(key)) drawn.set(key, cell)
  }

  const found: CellArt[] = []
  const artIndex = (art: CellArt | null): number | null => {
    if (!art) return null
    const at = found.findIndex((a) => a.src === art.src && a.tile === art.tile && a.offsetX === art.offsetX && a.offsetY === art.offsetY && a.bleed === art.bleed && a.priority === art.priority)
    if (at >= 0) return at
    found.push(art)
    return found.length - 1
  }

  const unsorted: BoardCellView[] = [...drawn.values()].map((cell) => {
    const key = coordKey(cell)
    const terrain = board.terrain[key]
    const { x, y } = toPlane(cell)
    const there = reachableByKey.get(key)
    const hazard = getCellHazard(state, cell)
    const light = getCellLight(state, cell)
    return {
      key,
      cell,
      x,
      y,
      terrain: terrain?.blocking ? (terrain.transparent ? 'glass' : 'wall') : terrain?.liquid ? 'water' : terrain?.difficult ? 'rough' : 'open',
      strength: terrain?.blocking ? (terrain.RES === null ? 'unbreakable' : `RES ${terrain.RES}`) : null,
      elevation: terrain?.elevation ?? 0,
      elevationLabel: elevationLabel(terrain?.elevation ?? 0),
      fire: hazard.fire,
      fuels: getCellFuels(state, cell),
      suffocating: hazard.suffocating,
      visibility: hazard.visibility === 'good' ? null : hazard.visibility,
      noise: terrain?.noise ?? 0,
      surface: terrain?.surface ?? board.surface,
      art: artIndex(getCellArt(board, key)),
      light,
      lit: light === 'bright' && (board.light !== 'bright' || !!terrain?.dark),
      unseen: false,
      occupants: occupancy[key] ?? [],
      reachable: there ? { steps: there.steps, cost: there.cost } : null,
      pathStep: pathByKey.get(key) ?? null,
      swept: swept.has(key),
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

  // lowest priority first, ties in the order they were met, so that a
  // higher one is drawn over a lower
  const drawing = found.map((_, i) => i).sort((a, b) => found[a].priority - found[b].priority || a - b)
  const arts = drawing.map((i) => found[i])
  const place = new Map(drawing.map((from, to) => [from, to]))
  const cells: BoardCellView[] = unsorted.map((c) => (c.art === null ? c : { ...c, art: place.get(c.art) ?? null }))

  const awaited = new Set(getAwaited(state))
  const tokens: BoardTokenView[] = Object.entries(board.placements).flatMap(([id, placement]) => {
    const c = state.characters[id]
    if (!c) return []
    const footprint = getFootprint(c, placement).map((cell) => ({ key: coordKey(cell), ...toPlane(cell) }))
    const anchor = toPlane(placement.cell)
    const toward = getBodyCoverToward(state, id)
    const facing = toward ? angleBetween(anchor, toPlane(toward)) : null
    return [{
      id,
      name: getFightName(state, id),
      image: c.token,
      x: anchor.x,
      y: anchor.y,
      cells: footprint,
      elevation: placement.elevation,
      depth: getDepth(state, id),
      orientation: placement.orientation,
      isActive: id === state.activeCharacterId,
      isInTurn: id === state.inTurnCharacter,
      role: open ? getRole(state, open, id) : null,
      targetable: targets.has(id),
      awaited: awaited.has(id),
      shieldAngle: facing === null ? null : (facing * 180) / Math.PI,
    }]
  })

  const floorPicker = getFloorPicker(state, state.activeCharacterId)
  const pickable = new Set(floorPicker?.itemIds ?? [])
  const struck = new Set(getDeclaredFloorTargets(state, open).map((f) => f.item.id))
  const stacks = new Map<string, number>()
  const floor: BoardFloorItemView[] = state.floor.flatMap((f) => {
    if (!f.cell) return []
    const key = coordKey(f.cell)
    const stack = stacks.get(key) ?? 0
    stacks.set(key, stack + 1)
    const { x, y } = toPlane(f.cell)
    return [{ itemId: f.item.id, name: f.item.name, x: x + 0.55, y: y - 0.5 + stack * 0.36, pickable: pickable.has(f.item.id), targetable: struck.has(f.item.id) }]
  })

  const binds: BoardBindView[] = state.binds.flatMap((g) => {
    const [a, b] = g.members
    const pa = board.placements[a]
    const pb = board.placements[b]
    if (!pa || !pb) return []
    const title = g.members.flatMap((id) => (holds(g, id) ? [`${getFightName(state, id)} ${getBindVerb(g)} ${getFightName(state, getPartner(g, id))}`] : [])).join(' · ')
    return [{ key: `${g.kind}:${a}~${b}`, kind: g.kind, ...rimToRim(toPlane(pa.cell), toPlane(pb.cell)), forward: holds(g, a), back: holds(g, b), title }]
  })

  const mover = move ? board.placements[move.actorId] : undefined
  return {
    present: true,
    extent: board.extent,
    light: board.light,
    frame: hexBounds(cells),
    surface: board.surface,
    surfaces: getSurfaceChoices(),
    arts,
    viewBox: frameHexes(cells),
    hex: HEX_POINTS,
    cells,
    tokens,
    floor,
    binds,
    ghosts,
    picker: floorPicker?.picker ?? null,
    unplaced: Object.values(state.characters).filter((c) => !board.placements[c.id] && !isOffGrid(state, c.id)).map((c) => ({ id: c.id, name: getFightName(state, c.id) })),
    mode: getBoardMode(state),
    move: move && mover
      ? { actorId: move.actorId, orientation: move.orientation ?? mover.orientation, canTurn: getFootprint(state.characters[move.actorId], mover).length > 1 }
      : null,
  }
}

export const getBoardView = perState(buildBoardView)

// What the table is told before the board shrinks to `extent`: who comes off
// it, and how many items on the floor and painted cells are lost beyond the
// new edge. Null when the board does not shrink on any axis.
export function getResizeWarning(state: SceneState, extent: BoardExtent): string | null {
  const board = state.board
  if (!board || (extent.q >= board.extent.q && extent.r >= board.extent.r && extent.s >= board.extent.s)) return null
  const beyond = getBeyondEdge(state, extent)
  const lost = [
    beyond.characters.length ? `${beyond.characters.map((id) => getFightName(state, id)).join(', ')} off the board` : null,
    beyond.floor.length ? `${beyond.floor.length} item${beyond.floor.length === 1 ? '' : 's'} off the floor` : null,
    beyond.terrain.length ? `${beyond.terrain.length} painted cell${beyond.terrain.length === 1 ? '' : 's'} dropped` : null,
  ].filter((s) => s !== null)
  return `shrink the board to ${extent.q} × ${extent.r} × ${extent.s}: ${lost.length ? lost.join('; ') : 'nothing lies beyond the new edge'}`
}

// The board as the active character's eyes take it in: the cells none of
// their active senses reach are marked unseen, and only they and the
// characters they detect are drawn, with what lies on cells they see and the
// binds between characters drawn. The whole board when nobody placed is active.
export const getBoardViewFrom = perState((state: SeenScene): BoardView => {
  const view = getBoardView(state)
  const eye = state.activeCharacterId
  if (!view.present || !eye || !state.board?.placements[eye]) return view
  const sight = getSightOf(state, eye)
  const shown = (id: string) => id === eye || sight.has(id)
  const senses = getCellSenser(state, eye)
  const cells = view.cells.map((c) => (senses(c.cell) ? c : { ...c, unseen: true }))
  const unseen = new Set(cells.filter((c) => c.unseen).map((c) => c.key))
  const tokens = view.tokens.filter((t) => shown(t.id))
  const drawn = new Set(tokens.map((t) => t.id))
  return {
    ...view,
    cells,
    tokens,
    ghosts: view.ghosts.filter((g) => drawn.has(g.id)),
    floor: view.floor.filter((f) => { const at = state.floor.find((x) => x.item.id === f.itemId)?.cell; return !at || !unseen.has(coordKey(at)) }),
    binds: view.binds.filter((b) => b.key.slice(b.key.indexOf(':') + 1).split('~').every((id) => drawn.has(id))),
  }
})

// The segment between two token centres that lies outside both tokens'
// circles; the centres themselves when the tokens overlap.
const TOKEN_RIM = 0.66

// What a holder does to the one at the other end, as the link's title says it.
function getBindVerb(b: Bind): string {
  switch (b.kind) {
    case 'grapple': return 'holds'
    case 'tether': return 'has tied'
    case 'arc': return `holds ${isSpellKey(b.key) ? SPELLS[b.key].name : b.key} on`
    case 'link': return `holds a ${isSpellKey(b.key) ? SPELLS[b.key].name : b.key} link to`
  }
}

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

export const getBoardViewDigest = perState((state: SeenScene) => JSON.stringify(getBoardView(state)))
export const getBoardViewFromDigest = perState((state: SeenScene) => JSON.stringify(getBoardViewFrom(state)))
