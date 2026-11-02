import type { Bind, Board, BoardExtent, SceneState, SeenScene, Coord, Degree, LightLevel, Placement, StructureArt, SurfaceArt } from '../types'
import type { Fuel, Visibility } from '../../types'
import { SPELLS, isSpellKey } from '../../spells'
import type { ActionCost } from '../../character/rules/actionCosts'
import { DIRECTIONS, HEX_POINTS, ROTATIONS, getChordEnds, getHexPoints, add, angleBetween, coordKey, extentCells, frameHexes, getFaceGrain, hexBounds, hexSide, parseCoordKey, sameCell, toPlane } from '../rules/board/geometry'
import { isCliff } from '../rules/board/cliff'
import { getBeyondEdge, getBodyCoverToward, getFootprint, getOccupancy, getStoreyFloor } from '../rules/board/board'
import { getPieceAt } from '../rules/board/piece'
import { getDeclaredFloorTargets, getDeclaredTargets } from '../rules/action'
import { findOpenRoot, getOpenAction, getReactionsTo } from '../rules/log'
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
import { getCellLighting } from '../rules/board/light'
import { CHORD_BRUSH_CORNER, CHORD_DRAWN_THICKNESS, WALL_DRAWN_HEIGHT } from '../../lists'
import { getCellArt, getCellBledInto, getCellSurfaceName, getSurface, getSurfaceChoices, type CellArt } from '../rules/board/surface'
import { getAwaited } from '../rules/options'
import { getCellSenser } from '../rules/detection'
import { getSightOf } from '../rules/seen'
import { isOffGrid } from '../rules/parked'

// The board as the simulation tool draws it: every cell with what is on it
// and what a click there would mean, every placed character with the cells
// it covers, and the plane coordinates of all of it — flat-top hexes of
// unit spacing, so the panel only has to translate and scale.

export type CellTerrain = 'open' | 'wall' | 'glass' | 'water' | 'rough'

export type BoardCellView = {
  key: string
  cell: Coord
  x: number
  y: number
  // the order the board is drawn in, back to front: a cell is drawn over every
  // cell of a lower band (all in band 0 where the board is seen from above)
  band: number
  // metres a wall in the cell is drawn standing above its ground, 0 for none:
  // up to the lowest storey laid over it, else a standard height
  wall: number
  // how much of its hex the cell's top is drawn across, 1 for the whole of it:
  // less only for raised ground painted thinner that stands over the lowest
  // ground beside it, `around` metres up, which is drawn around its foot
  // (`BoardView.rims`); `hex` is the corners of that thinner top, null for the
  // board's own `hex`
  width: number
  around: number
  hex: string | null
  // seen from the front, where the cell stands on the ground whatever its
  // height: the space a click there picks; null where the board is seen from
  // above and the cell is picked where it is drawn
  base: { x: number; y: number } | null
  // seen from the front, what the cell is veiled with: its own top, walls and
  // thin walls, the cell's key; empty seen from above
  group: string
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
  // combat.tex "Climbing": the DL of climbing up to this cell, null for a face
  // with nothing to hold
  climbDL: number | null
  // the test the cell's ground asks of whoever crosses it, and its DL:
  // swimming in water (combat.tex "Swimming"), balance on difficult ground
  // (combat.tex "Balance"); null for neither
  test: { kind: 'swim' | 'balance'; DL: number } | null
  // combat.tex "Fall damage": ground that halves a fall onto it
  soft: boolean
  // what the ground is made of: its name in the surfaces catalog, and the
  // texture it is drawn with; null for ground with none
  surface: string | null
  // the picture it is drawn with: its place in the board's `arts`, null for none
  art: number | null
  // how much of a neighbouring picture's spreading the cell lets in, 0 to 1
  bledInto: number
  // combat.tex "Darkness and light": the light on the cell, and whether it
  // is a light source that makes it bright
  light: LightLevel
  lit: boolean
  // the board seen from the active character's eyes: no active sense of theirs
  // takes the cell in (`getBoardViewFrom`)
  unseen: boolean
  occupants: string[]
  // the storey the board is drawn at: a floor laid in the cell, a lattice
  // floor, a stairwell over the ground, open air over it, or a roof over a
  // floor the one looking does not see; null for the ground
  storey: 'floor' | 'lattice' | 'hole' | 'air' | 'roof' | null
  // the piece laid on the board the cell is part of, on the ground or a
  // storey, and whether it is the one picked in the editor
  piece: string | null
  chosen: boolean
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
  // where the token's shadow falls, on the ground under it, when the board is
  // seen from the front; null from above
  shadow: { x: number; y: number } | null
  // seen from the front, something drawn over the token's place hides it
  hidden: boolean
  // metres below the water's surface, 0 for one who breathes
  depth: number
  orientation: number
  isActive: boolean
  isInTurn: boolean
  role: Role | null
  targetable: boolean
  // the committed action still waits on their answer (`getAwaited`)
  awaited: boolean
  // standing on another floor than the one the board is looked at from
  // (`getStoreyView`)
  elsewhere: boolean
  // combat.tex "Cover": in total cover behind a body shield, which faces
  // this way, in degrees; null out of it
  shieldAngle: number | null
  // combat.tex "Climbing": hanging on a face partway up, the cell it climbs
  // to, which way that is in degrees, and the metres of it climbed out of all
  // of them; null for one not hanging
  hanging: { to: string; angle: number; covered: number; height: number } | null
}

// Something lying on a cell, drawn over whoever stands there, and whether a
// click on it would pick it up: the active character with nothing open, or
// the one whose pick up is being declared, reaching it with a free hand.
// `x`/`y` put it at its cell's corner, items sharing a cell stacked
// downwards.
export type BoardFloorItemView = {
  itemId: string
  name: string
  // the key of the cell it lies on
  cell: string
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
  // the two characters it binds, whose tokens its ends are at
  ids: [string, string]
  from: { x: number; y: number }
  to: { x: number; y: number }
  forward: boolean
  back: boolean
  title: string
}

// A stretch of a cliff's drop, `from` to `to` metres high, painted by the
// layer of the cell standing there: a wall or solid ground with its surface's
// face (`art` in the board's `faces`, null for one with none), or glass. Where
// the layer is open (a floor with nothing on it, a hole, a lattice) nothing is
// painted and there is no band. `face` is where it is drawn, null where it is
// not: seen from above only the band at the top of the drop shows.
export type BoardFaceBand = {
  key: string
  from: number
  to: number
  art: number | null
  glass: boolean
  face: string | null
}

// The top edge of a cliff, between a cell and a neighbour at least a cliff's
// height lower: `a` to `b` is the ridge, the drop falls over the lower ground
// to `foot`, `bands` are what paints it, and `height` the metres it drops.
export type BoardRidgeView = {
  key: string
  // the cell on the higher side and the side of it that drops, a direction
  cell: string
  side: number
  // the band of the cell, which the ridge is drawn with
  band: number
  a: { x: number; y: number }
  b: { x: number; y: number }
  foot: { x: number; y: number }
  bands: BoardFaceBand[]
  // what the wall is drawn as part of: that of the cell it drops from
  group: string
  // how the picture lies on the face (`getFaceGrain`)
  grain: string
  height: number
}

// A piece with a picture of its own, as the front view draws it: the picture,
// where its foot stands (the anchor's cell, on the ground the piece was laid
// on, `base` metres up) and the heights in metres above that foot at which a
// storey of the piece begins, which the picture is sliced at.
export type BoardStandingView = {
  key: string
  art: StructureArt
  x: number
  y: number
  base: number
  // the height in metres of the highest ground of the piece itself, which its
  // picture is drawn over
  top: number
  cuts: number[]
}

// One slice of such a picture, drawn in the band of the piece's highest ground
// so that it lies over the piece's own cells: the whole picture's box, and the
// part of it this slice shows.
export type BoardSpriteView = {
  key: string
  // the piece it is the picture of
  group: string
  src: string
  band: number
  box: { x: number; y: number; width: number; height: number }
  clip: { x: number; y: number; width: number; height: number }
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

// A thin wall cutting a corner off its cell: the cell it stands in (`x`, `y`
// its centre), on ground `elevation` metres up and `height` metres tall,
// whether it is glass, and where it is drawn: its top, and seen from the front
// the wall under that top as the viewer sees it (null from above).
export type BoardChordView = {
  key: string
  cell: string
  x: number
  y: number
  band: number
  group: string
  glass: boolean
  elevation: number
  height: number
  top: string
  side: string | null
}

// A see-through floor (a lattice) over the floor a cell is drawn as, drawn
// over it at its own height.
// A lattice over the floor a cell is drawn as (`below` metres up),
// `elevation` metres up, and the picture of the surface laid on it, null for
// none; the middle of the shadow it casts on that floor; and, seen from the
// front, the sides of its leaves facing the viewer, each a polygon's points.
export type BoardOverheadView = { key: string; cell: Coord; x: number; y: number; elevation: number; below: number; art: CellArt | null; shadow: { x: number; y: number }; slab: string[] }

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
  ridges: BoardRidgeView[]
  chords: BoardChordView[]
  // the ground around the foot of every cell drawn thinner than its hex, one
  // to each such cell under its key and `:rim`, at the height `around` and
  // drawn before it; plain ground, with nothing offered on it
  rims: BoardCellView[]
  overhead: BoardOverheadView[]
  // the pictures the cliffs are drawn with, which a face band's `art` indexes
  faces: SurfaceArt[]
  // the pieces drawn with a picture of their own, and (from the front only)
  // the slices of those pictures
  standing: BoardStandingView[]
  sprites: BoardSpriteView[]
  // how many bands the cells are drawn in, and whether they are seen from the
  // front, the raised ones lifted up the screen
  bands: number
  front: boolean
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

const compareArts = (a: CellArt, b: CellArt): number =>
  a.priority - b.priority
  || (a.src < b.src ? -1 : a.src > b.src ? 1 : 0)
  || a.tile - b.tile
  || a.offsetX - b.offsetX
  || a.offsetY - b.offsetY
  || a.bleed - b.bleed
  || a.roughness - b.roughness
  || a.bank - b.bank

const EMPTY: BoardView = { present: false, extent: { q: 0, r: 0, s: 0 }, viewBox: '0 0 1 1', hex: '', light: 'bright', frame: { x: 0, y: 0, width: 1, height: 1 }, surface: null, surfaces: [], arts: [], cells: [], ridges: [], chords: [], rims: [], overhead: [], faces: [], standing: [], sprites: [], bands: 1, front: false, tokens: [], floor: [], binds: [], ghosts: [], picker: null, unplaced: [], mode: 'locked', move: null }

function buildBoardView(state: SeenScene): BoardView {
  const board = state.board
  if (!board) return { ...EMPTY, unplaced: Object.values(state.characters).filter((c) => !isOffGrid(state, c.id)).map((c) => ({ id: c.id, name: getFightName(state, c.id) })) }

  const open = getOpenAction(state)
  // the move in play, whatever its phase: its path stays drawn throughout;
  // so does the way a push takes its block (combat.tex "Push and drag")
  const walking = findOpenRoot(state, 'drag')
  // abilities.tex "Steady Arms": the careful path drawn with a shot being declared
  const steady = open?.kind === 'shoot' && open.step === 'define' && isSteadyShot(state, open) ? getSteadyPath(state, open) : null
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
  const zones = new Map(laid ? getExplosionZones(state, laid).filter((z) => z.floor === (board.terrain[coordKey(z.cell)]?.elevation ?? 0)).map((z) => [coordKey(z.cell), z.degree]) : [])

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
    const at = found.findIndex((a) => a.src === art.src && a.tile === art.tile && a.offsetX === art.offsetX && a.offsetY === art.offsetY && a.bleed === art.bleed && a.roughness === art.roughness && a.bank === art.bank && a.priority === art.priority)
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
    const { light, lit } = getCellLighting(state, cell)
    return {
      key,
      cell,
      x,
      y,
      band: 0,
      wall: terrain?.blocking ? getWallHeight(board, key, terrain.elevation) : 0,
      width: terrain?.width ?? 1,
      around: 0,
      hex: null,
      base: null,
      group: '',
      terrain: terrain?.blocking ? (terrain.transparent ? 'glass' : 'wall') : terrain?.liquid ? 'water' : terrain?.difficult ? 'rough' : 'open',
      strength: terrain?.blocking || terrain?.chords.length ? (terrain.RES === null ? 'unbreakable' : `RES ${terrain.RES}`) : null,
      elevation: terrain?.elevation ?? 0,
      elevationLabel: elevationLabel(terrain?.elevation ?? 0),
      fire: hazard.fire,
      fuels: getCellFuels(state, cell),
      suffocating: hazard.suffocating,
      visibility: hazard.visibility === 'good' ? null : hazard.visibility,
      noise: terrain?.noise ?? 0,
      climbDL: terrain?.climbDL ?? null,
      test: terrain?.liquid ? { kind: 'swim', DL: terrain.DL } : terrain?.difficult ? { kind: 'balance', DL: terrain.DL } : null,
      soft: terrain?.soft ?? false,
      surface: getCellSurfaceName(board, key),
      art: artIndex(getCellArt(board, key)),
      bledInto: getCellBledInto(board, key),
      light,
      lit,
      unseen: false,
      occupants: occupancy[key] ?? [],
      storey: null,
      piece: getPieceAt(board, key),
      chosen: false,
      reachable: there ? { steps: there.steps, cost: there.cost } : null,
      pathStep: pathByKey.get(key) ?? null,
      swept: swept.has(key),
      isDestination: destination !== null && sameCell(destination, cell),
      jump: landings.has(key),
      isJumpTo: jumpTo !== null && sameCell(jumpTo, cell),
      center: centers.has(key),
      isCenter: aimedAt !== null && sameCell(aimedAt, cell),
      threatened: threatened.has(key),
      zone: zones.get(key) ?? null,
      items: state.floor.filter((f) => f.cell !== null && sameCell(f.cell, cell)).map((f) => f.item.name),
    }
  })

  // lowest priority first, so that a higher one is drawn over a lower; ties
  // by the pictures themselves, so that which of two is drawn over the other
  // never depends on which cell happened to be met first
  const drawing = found.map((_, i) => i).sort((a, b) => compareArts(found[a], found[b]))
  const arts = drawing.map((i) => found[i])
  const place = new Map(drawing.map((from, to) => [from, to]))
  const cells: BoardCellView[] = getThinTops(unsorted.map((c) => (c.art === null ? c : { ...c, art: place.get(c.art) ?? null })))

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
      shadow: null,
      hidden: false,
      depth: getDepth(state, id),
      orientation: placement.orientation,
      isActive: id === state.activeCharacterId,
      isInTurn: id === state.inTurnCharacter,
      role: open ? getRole(state, open, id) : null,
      targetable: targets.has(id),
      awaited: awaited.has(id),
      elsewhere: false,
      shieldAngle: facing === null ? null : (facing * 180) / Math.PI,
      hanging: placement.climb ? { to: coordKey(placement.climb.to), angle: (angleBetween(anchor, toPlane(placement.climb.to)) * 180) / Math.PI, covered: placement.climb.covered, height: Math.abs(placement.climb.bound - placement.climb.floor) } : null,
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
    return [{ itemId: f.item.id, name: f.item.name, cell: key, x: x + 0.55, y: y - 0.5 + stack * 0.36, pickable: pickable.has(f.item.id), targetable: struck.has(f.item.id) }]
  })

  const binds: BoardBindView[] = state.binds.flatMap((g) => {
    const [a, b] = g.members
    const pa = board.placements[a]
    const pb = board.placements[b]
    if (!pa || !pb) return []
    const title = g.members.flatMap((id) => (holds(g, id) ? [`${getFightName(state, id)} ${getBindVerb(g)} ${getFightName(state, getPartner(g, id))}`] : [])).join(' · ')
    return [{ key: `${g.kind}:${a}~${b}`, kind: g.kind, ids: [a, b] as [string, string], ...rimToRim(toPlane(pa.cell), toPlane(pb.cell)), forward: holds(g, a), back: holds(g, b), title }]
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
    ...getRidges(board, cells, board),
    chords: getChords(board, cells),
    rims: getRims(cells),
    standing: getStanding(board, cells),
    sprites: [],
    overhead: [],
    bands: 1,
    front: false,
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
  const painted = beyond.terrain.length + beyond.levels.reduce((n, cells) => n + cells.length, 0)
  const lost = [
    beyond.characters.length ? `${beyond.characters.map((id) => getFightName(state, id)).join(', ')} off the board` : null,
    beyond.floor.length ? `${beyond.floor.length} item${beyond.floor.length === 1 ? '' : 's'} off the floor` : null,
    beyond.pieces.length ? `${beyond.pieces.map((id) => board.pieces[id].name || 'a structure').join(', ')} lifted` : null,
    painted ? `${painted} painted cell${painted === 1 ? '' : 's'} dropped` : null,
  ].filter((s) => s !== null)
  return `shrink the board to ${extent.q} × ${extent.r} × ${extent.s}: ${lost.length ? lost.join('; ') : 'nothing lies beyond the new edge'}`
}

// The board as the active character's eyes take it in: the cells none of
// their active senses reach are marked unseen, and only they and the
// characters they detect are drawn, with what lies on cells they see and the
// binds between characters drawn. The whole board when nobody placed is active.
// A cell someone they detect stands in is taken in at that one's floor: on a
// board with storeys, the floor the eye's own feet would reach there may be
// out of sight under the one the character stands on.
export const getBoardViewFrom = perState((state: SeenScene): BoardView => {
  const view = getBoardView(state)
  const eye = state.activeCharacterId
  const placements = state.board?.placements
  if (!view.present || !eye || !placements?.[eye]) return view
  const sight = getSightOf(state, eye)
  const shown = (id: string) => id === eye || sight.has(id)
  const senses = getCellSenser(state, eye)
  const tokens = view.tokens.filter((t) => shown(t.id))
  const standing = new Map(tokens.flatMap((t) => t.cells.map((c) => [c.key, placements[t.id]?.elevation] as const)))
  const sensed = (c: BoardCellView) => {
    const floor = standing.get(c.key)
    return senses(c.cell) || (floor !== undefined && senses(c.cell, floor))
  }
  const cells = view.cells.map((c) => (sensed(c) ? c : { ...c, unseen: true }))
  const unseen = new Set(cells.filter((c) => c.unseen).map((c) => c.key))
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

// How far a cliff's face is drawn over the lower ground, in board units: so
// much a metre of the drop, up to a most.
const FACE_PER_METRE = 0.03
const FACE_MOST = 0.12

// How tall a wall is drawn: up to the lowest storey laid over it, or the
// standard height where there is none.
function getWallHeight(board: Board, key: string, elevation: number): number {
  const ceiling = Math.min(Infinity, ...board.levels.flatMap((l) => (l.terrain[key] ? [getStoreyFloor(l, l.terrain[key])] : [])).filter((floor) => floor > elevation))
  return Number.isFinite(ceiling) ? ceiling - elevation : WALL_DRAWN_HEIGHT
}

// The thin walls cutting corners off the cells, each drawn as a strip along
// its chord, standing as high as a wall in the cell would.
function getChords(board: Board, cells: BoardCellView[]): BoardChordView[] {
  const half = CHORD_DRAWN_THICKNESS / 2
  return cells.flatMap((c) => {
    const terrain = board.terrain[c.key]
    if (!terrain?.chords.length) return []
    const height = getWallHeight(board, c.key, terrain.elevation)
    return terrain.chords.map((corner) => {
      const [p, q] = getChordEnds(corner)
      const length = Math.hypot(q.x - p.x, q.y - p.y)
      const [nx, ny] = [-(q.y - p.y) / length * half, (q.x - p.x) / length * half]
      const top = [{ x: p.x - nx, y: p.y - ny }, { x: q.x - nx, y: q.y - ny }, { x: q.x + nx, y: q.y + ny }, { x: p.x + nx, y: p.y + ny }]
        .map((v) => `${(c.x + v.x).toFixed(4)},${(c.y + v.y).toFixed(4)}`).join(' ')
      return { key: `${c.key}:chord${corner}`, cell: c.key, x: c.x, y: c.y, band: c.band, group: c.group, glass: terrain.transparent, elevation: terrain.elevation, height, top, side: null }
    })
  })
}

// What each thin-wall brush paints, drawn on its button: a unit hex and the
// chord it lays, as SVG points.
export type BrushIcon = { hex: string; chord: string }
export const CHORD_BRUSH_ICONS: Record<keyof typeof CHORD_BRUSH_CORNER, BrushIcon> = Object.fromEntries(
  Object.entries(CHORD_BRUSH_CORNER).map(([brush, corner]) => [brush, { hex: HEX_POINTS, chord: getChordEnds(corner).map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ') }]),
) as Record<keyof typeof CHORD_BRUSH_CORNER, BrushIcon>

// Each cell's top: drawn thinner than its hex where it is painted so and stands
// over the lowest ground beside it on the board, which is drawn around its
// foot; else across its whole hex, its edge as high as its top.
function getThinTops(cells: BoardCellView[]): BoardCellView[] {
  const groundAt = new Map(cells.map((c) => [c.key, c.elevation]))
  return cells.map((c) => {
    const top = c.elevation + c.wall
    const beside = ROTATIONS.flatMap((d) => groundAt.get(coordKey(add(c.cell, DIRECTIONS[d]))) ?? [])
    const around = Math.min(top, ...beside)
    return c.width < 1 && around < top ? { ...c, around, hex: getHexPoints(c.width) } : { ...c, width: 1, around: top }
  })
}

// The ground around the foot of every cell drawn thinner than its hex: the
// cell's own ground at the height beside it, with nothing on it.
function getRims(cells: BoardCellView[]): BoardCellView[] {
  return cells.filter((c) => c.width < 1).map((c) => ({
    ...c, key: `${c.key}:rim`, wall: 0, width: 1, hex: null, elevation: c.around, elevationLabel: '', terrain: 'open', strength: null,
    fire: 0, fuels: [], suffocating: false, noise: 0, climbDL: null, test: null, occupants: [], reachable: null, pathStep: null, swept: false,
    isDestination: false, jump: false, isJumpTo: false, center: false, isCenter: false, threatened: false, zone: null, items: [], chosen: false, storey: null,
  }))
}

// What stands in a cell from the bottom up, each layer reaching to the floor of
// the next: the ground's solid earth up to its top, the ground's own cell, then
// every storey laid over it. A layer that blocks paints a drop with its face,
// as glass when it is clear; the rest are open and paint nothing.
type FaceLayer = { from: number; to: number; face: SurfaceArt | null; paints: 'solid' | 'glass' | null }
function getFaceLayers(board: Board, key: string): FaceLayer[] {
  const ground = board.terrain[key]
  const faceOf = (surface: string | null | undefined) => (surface ? getSurface(surface)?.face ?? null : null)
  const paints = (t: { blocking: boolean; transparent: boolean; hole?: boolean; lattice?: boolean } | undefined) =>
    !t || !t.blocking || t.hole || t.lattice ? null : t.transparent ? 'glass' as const : 'solid' as const
  const floors = [
    { floor: ground?.elevation ?? 0, face: faceOf(ground?.surface), paints: paints(ground) },
    ...board.levels.flatMap((l) => (l.terrain[key] ? [{ floor: getStoreyFloor(l, l.terrain[key]), face: faceOf(l.terrain[key].surface), paints: paints(l.terrain[key]) }] : [])),
  ].sort((a, b) => a.floor - b.floor)
  return [
    { from: -Infinity, to: floors[0].floor, face: faceOf(ground?.surface), paints: 'solid' },
    ...floors.map((f, i) => ({ from: f.floor, to: floors[i + 1]?.floor ?? Infinity, face: f.face, paints: f.paints })),
  ]
}

// Every side where ground drops a cliff's height or more to the neighbour, read
// off the two elevations, so that nothing marks which way a cliff faces: the
// higher cell is the ridge. The drop is painted from the top down by what
// stands in the cell at each height on `stacked` (the board as it is, when the
// cells are drawn from a flattened copy of it), each layer its own band, the
// pictures listed once in `faces`. A drop where nothing paints is no ridge.
export function getRidges(board: Board, cells: BoardCellView[], stacked: Board): { ridges: BoardRidgeView[]; faces: SurfaceArt[] } {
  const faces: SurfaceArt[] = []
  const faceIndex = (face: SurfaceArt | null): number | null => {
    if (!face) return null
    const at = faces.findIndex((f) => f.src === face.src && f.tile === face.tile && f.offsetX === face.offsetX && f.offsetY === face.offsetY)
    if (at >= 0) return at
    faces.push(face)
    return faces.length - 1
  }
  const edgeAt = new Map(cells.map((c) => [c.key, c.around]))
  const ridges = cells.flatMap((c) => {
    const layers = getFaceLayers(stacked, c.key)
    return ROTATIONS.flatMap((d) => {
      const next = add(c.cell, DIRECTIONS[d])
      const high = c.elevation + c.wall
      const low = c.width < 1 ? c.around : edgeAt.get(coordKey(next)) ?? board.terrain[coordKey(next)]?.elevation ?? 0
      if (!isCliff(low, high) || low > high) return []
      const height = high - low
      const [p, q] = hexSide(d)
      const a = { x: c.x + p.x * c.width, y: c.y + p.y * c.width }
      const b = { x: c.x + q.x * c.width, y: c.y + q.y * c.width }
      const away = toPlane(DIRECTIONS[d])
      const depth = Math.min(FACE_MOST, FACE_PER_METRE * height) / Math.hypot(away.x, away.y)
      const [dx, dy] = [away.x * depth, away.y * depth]
      const strip = [a, b, { x: b.x + dx, y: b.y + dy }, { x: a.x + dx, y: a.y + dy }].map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ')
      const foot = { x: (a.x + b.x) / 2 + dx, y: (a.y + b.y) / 2 + dy }
      const bands: BoardFaceBand[] = layers.flatMap((l, i) => {
        const [from, to] = [Math.max(l.from, low), Math.min(l.to, high)]
        if (!l.paints || to <= from) return []
        return [{ key: `${c.key}:${d}:${i}`, from, to, art: faceIndex(l.face), glass: l.paints === 'glass', face: to === high ? strip : null }]
      })
      if (bands.length === 0) return []
      return [{ key: `${c.key}:${d}`, cell: c.key, side: d, band: c.band, a, b, foot, bands, grain: getFaceGrain(a, b, foot), group: '', height }]
    })
  })
  return { ridges, faces }
}

// A picture standing on the cell at its anchor, cut where the floors (in
// metres above its foot) begin inside the picture's height; none for a picture
// with no file or no cell to stand on.
export function getStandingOf(key: string, art: StructureArt | null, anchor: Pick<BoardCellView, 'x' | 'y'> | undefined, base: number, top: number, floors: number[]): BoardStandingView[] {
  if (!art || !art.src || !anchor) return []
  const cuts = [...new Set(floors)].filter((h) => h > 0 && h < art.height).sort((a, b) => a - b)
  return [{ key, art, x: anchor.x, y: anchor.y, base, top: Math.max(base, top), cuts }]
}

// Every piece that has a picture, at its anchor.
function getStanding(board: Board, cells: BoardCellView[]): BoardStandingView[] {
  return Object.entries(board.pieces).flatMap(([id, piece]) => getStandingOf(
    id, piece.art, cells.find((c) => c.key === coordKey(piece.cell)), piece.elevation,
    Math.max(0, ...Object.values(board.terrain).filter((cell) => cell.piece === id).map((cell) => cell.elevation)),
    board.levels.filter((l) => l.piece === id).map((l) => l.floor - piece.elevation),
  ))
}

function elevationLabel(elevation: number): string {
  return elevation > 0 ? `+${elevation}` : elevation < 0 ? `${elevation}` : ''
}

export const getBoardViewDigest = perState((state: SeenScene) => JSON.stringify(getBoardView(state)))
export const getBoardViewFromDigest = perState((state: SeenScene) => JSON.stringify(getBoardViewFrom(state)))
