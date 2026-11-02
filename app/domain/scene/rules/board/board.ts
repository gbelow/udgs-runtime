import type { Character, Damage, MeleeRange, Weapon, WeaponAttack } from '../../../types'
import type { Board, BoardExtent, SceneState, Coord, Level, LevelCell, Placement, ShootAction, StrikeAction, TerrainCell } from '../../types'
import { TerrainCellSchema } from '../../types'
import { getHeight } from '../../../character/rules/size'
import { FALL, REACH, RMArr } from '../../../tables'
import { isMeleeRange } from '../../../weaponProperties'
import { getWieldedWeapons } from '../../../item/rules/hands'
import { add, angleBetween, angularGap, centroid, coordKey, crossingAt, disk, distance, getChordAt, inExtent, line, parseCoordKey, rotate, sameCell, setDistance, toPlane } from './geometry'
import { findRowVariant, findWeaponRow, getWeaponRows, isRowUsable } from '../weaponRow'
import { getChaseDistance, getChaseTierBetween, isChaseMate, reachesTier } from '../chase'
import { without } from '../../../utils'
import { getPieceCells, liftPiece } from './piece'

// The board rules read the spatial facts of a fight off `state.board`.
// Every rule that answers for a fight answers null, or "passes", when the
// fight has no board or the character asked about is not placed on it: the
// domain does not know where anyone stands, so no positional rule can close
// anything.

// ---------------------------------------------------------------------------
// Footprints

// creating.tex "Size and Space Occupation": the cells a placed character
// covers on the board: its footprint turned to the placement's orientation
// and moved to its anchor.
export function getFootprint(c: Character, placement: Placement): Coord[] {
  return c.footprint.map((offset) => add(placement.cell, rotate(offset, placement.orientation)))
}

// What lies beyond the edge of the board were it `extent` from its origin
// along each axis: whoever has a cell of their footprint out there, the items
// on the floor out there, by id, and the painted cells, by key.
// A piece with any cell beyond goes whole (`pieces`), and `terrain` and
// `levels` are what is left beyond once it is lifted, `levels` holding the
// cells of each storey in the order of the lifted board's `levels`.
export function getBeyondEdge(state: SceneState, extent: BoardExtent): { characters: string[]; floor: string[]; pieces: string[]; terrain: string[]; levels: string[][] } {
  const board = state.board
  if (!board) return { characters: [], floor: [], pieces: [], terrain: [], levels: [] }
  const beyond = (cell: Coord) => !inExtent(board.origin, extent, cell)
  const isBeyond = (key: string) => { const cell = parseCoordKey(key); return cell === null || beyond(cell) }
  const pieces = Object.keys(board.pieces).filter((id) => getPieceCells(board, id).some(isBeyond))
  const lifted = pieces.reduce(liftPiece, board)
  return {
    characters: Object.entries(board.placements).filter(([id, p]) => state.characters[id] && getFootprint(state.characters[id], p).some(beyond)).map(([id]) => id),
    floor: state.floor.filter((f) => f.cell !== null && beyond(f.cell)).map((f) => f.item.id),
    pieces,
    terrain: Object.keys(lifted.terrain).filter(isBeyond),
    levels: lifted.levels.map((level) => Object.keys(level.terrain).filter(isBeyond)),
  }
}

// Who stands on each cell, keyed like the terrain. A cell shared by two
// characters (creating.tex allows it mid-turn) lists both.
export function getOccupancy(board: Board, characters: Record<string, Character>): Record<string, string[]> {
  const occupancy: Record<string, string[]> = {}
  for (const [id, placement] of Object.entries(board.placements)) {
    const c = characters[id]
    if (!c) continue
    for (const cell of getFootprint(c, placement)) {
      const key = coordKey(cell)
      occupancy[key] = [...(occupancy[key] ?? []), id]
    }
  }
  return occupancy
}

// What someone stands on in a cell: the terrain there, how high its floor is,
// and the storey it is a floor of (its index in `levels`, null for the
// ground).
export type Footing = { terrain: TerrainCell | undefined; floor: number; level: number | null }

// How high a storey's floor is in a cell: the storey's floor, raised by the
// cell's own elevation (a stair's step up to the storey above).
export function getStoreyFloor(level: Level, cell: LevelCell): number {
  return level.floor + cell.elevation
}

// Every floor of the cell: the ground, and each storey's that is not a hole.
export function getFloors(board: Board, cell: Coord): Footing[] {
  const key = coordKey(cell)
  const ground = board.terrain[key]
  return [
    { terrain: ground, floor: ground?.elevation ?? 0, level: null },
    ...board.levels.flatMap((l, level) => (l.terrain[key] && !l.terrain[key].hole ? [{ terrain: l.terrain[key], floor: getStoreyFloor(l, l.terrain[key]), level }] : [])),
  ]
}

// The solid floors over a floor `floor` high in the cell, a cliff or more
// above it: what roofs it. A stairwell and a lattice roof nothing.
export function getRoofs(board: Board, cell: Coord, floor: number): Footing[] {
  const key = coordKey(cell)
  return getFloors(board, cell).filter((f) => f.level !== null && !board.levels[f.level].terrain[key]?.lattice && f.floor - floor >= FALL.minHeight)
}

// Whether a solid floor of the cell lies between two heights, the lower left
// out: what keeps light on one floor from another.
export function isFloorBetween(board: Board, cell: Coord, a: number, b: number): boolean {
  const key = coordKey(cell)
  return getFloors(board, cell).some((f) => f.level !== null && !board.levels[f.level].terrain[key]?.lattice && f.floor > Math.min(a, b) && f.floor <= Math.max(a, b))
}

// The floor someone whose feet are at `height` stands on in the cell: the
// highest there that is no cliff above them (combat.tex "Choosing Fall DL":
// a cliff is a metre or more), or the lowest where every floor is. A walk up a
// stair is ground under a stairwell rising less than a cliff a step until it
// meets the storey.
export function getTerrainAt(board: Board, cell: Coord, height: number): Footing {
  if (board.levels.length === 0) {
    const ground = board.terrain[coordKey(cell)]
    return { terrain: ground, floor: ground?.elevation ?? 0, level: null }
  }
  const floors = getFloors(board, cell)
  const reached = floors.filter((f) => f.floor - height < FALL.minHeight)
  return reached.length > 0
    ? reached.reduce((a, b) => (b.floor > a.floor ? b : a))
    : floors.reduce((a, b) => (b.floor < a.floor ? b : a))
}

// The floor of the cell someone whose feet are at `feet` stands on, the
// ground's when no height is given: where what lies on a floor (fire, gas,
// fuel) is kept and read.
export function getFloorTerrain(board: Board, cell: Coord, feet?: number): TerrainCell | undefined {
  return feet === undefined ? board.terrain[coordKey(cell)] : getTerrainAt(board, cell, feet).terrain
}

// The board with that floor changed; a ground cell nothing was painted on
// yet is a plain one.
export function withFloorAt(board: Board, cell: Coord, feet: number | undefined, change: (t: TerrainCell) => TerrainCell): Board {
  const key = coordKey(cell)
  const level = feet === undefined ? null : getTerrainAt(board, cell, feet).level
  if (level === null) return { ...board, terrain: { ...board.terrain, [key]: change(board.terrain[key] ?? TerrainCellSchema.parse({})) } }
  const storey = board.levels[level]
  const was = storey.terrain[key]
  return { ...board, levels: board.levels.map((l, i) => (i === level ? { ...l, terrain: { ...l.terrain, [key]: { ...was, ...change(was) } } } : l)) }
}

// A floor a climb may end on: the cell it is in, and the DL of the face
// climbed to reach it (combat.tex "Climbing": the board paints it on the
// higher side of the face).
export type ClimbStop = Footing & { cell: Coord; climbDL: number | null }

// A storey's floor under the ground of its own cell: a ledge on the face of
// raised ground, such as a tree's branch, met on the way up that face.
function isLedge(board: Board, cell: Coord, f: Footing): boolean {
  return f.level !== null && f.floor < (board.terrain[coordKey(cell)]?.elevation ?? 0)
}

// combat.tex "Climbing": every floor a climb from a floor `here` high in the
// cell `from` may end on, going over the face towards `to`, nearest first,
// the last the floor the face goes all the way to; empty where there is no
// face. Up, the face of the next cell goes to its highest floor, under the
// first solid floor over the climber's own cell, and every floor met on the
// way is a stop: the next cell's, and a lattice of the climber's own cell
// beside it. Down, it goes to the lowest floor of the next cell with no solid
// floor of it between, its higher floors and the ledges of the climber's own
// cell met on the way. A climb in the climber's own cell (`to` is `from`)
// goes up the face of raised ground they stand on a ledge of, to its ledges
// and its top, or, with none, to the first floor over them where it is a
// lattice (a canopy's branches, only reached from within the climber's start:
// cliff.ts `isClimbable`), and down through the floor they stand on where it is a ledge
// or a lattice, to every floor under it as far as the first solid one; its
// stops up come before those down. A ledge closes nothing on the way. Up
// before down. Storeys of a cell at one height (pieces laid over each other)
// are one stop, the first met.
export function getClimbStops(board: Board, from: Coord, here: number, to: Coord): ClimbStop[] {
  return listClimbStops(board, from, here, to).filter((s, i, all) => all.findIndex((t) => sameCell(t.cell, s.cell) && t.floor === s.floor) === i)
}

function listClimbStops(board: Board, from: Coord, here: number, to: Coord): ClimbStop[] {
  const at = (cell: Coord, climbDL?: number | null) => (f: Footing): ClimbStop => ({ ...f, cell, climbDL: climbDL === undefined ? f.terrain?.climbDL ?? null : climbDL })
  const solid = (cell: Coord) => (f: Footing) => !isLedge(board, cell, f) && (f.level === null || !board.levels[f.level].terrain[coordKey(cell)]?.lattice)
  const above = (f: Footing) => f.floor - here >= FALL.minHeight
  const below = (f: Footing) => here - f.floor >= FALL.minHeight
  const own = getFloors(board, from)
  if (sameCell(from, to)) {
    const top = board.terrain[coordKey(from)]?.elevation ?? 0
    const column = own.filter((f) => above(f) && f.floor <= top).sort((a, b) => a.floor - b.floor).map(at(from))
    const over = own.filter(above).sort((a, b) => a.floor - b.floor)[0]
    const up = column.length > 0 || !over || solid(from)(over) ? column : [at(from)(over)]
    const standing = getTerrainAt(board, from, here)
    const under = standing.level === null || solid(from)(standing) ? [] : own.filter(below).sort((a, b) => b.floor - a.floor)
    const floor = under.findIndex(solid(from))
    const down = (floor === -1 ? under : under.slice(0, floor + 1)).map(at(from, standing.terrain?.climbDL ?? null))
    return [...up, ...down]
  }
  const next = getFloors(board, to)
  const cap = Math.min(Infinity, ...own.filter((f) => f.level !== null && f.floor > here && solid(from)(f)).map((f) => f.floor))
  const up = next.filter((f) => above(f) && f.floor < cap).sort((a, b) => a.floor - b.floor).map(at(to))
  if (up.length > 0) {
    const end = up[up.length - 1]
    const beside = own.filter((f) => f.level !== null && above(f) && f.floor < end.floor && !solid(from)(f))
      .map((f) => at(from, up.find((s) => s.floor >= f.floor)!.climbDL)(f))
    return [...up, ...beside].sort((a, b) => a.floor - b.floor || (sameCell(a.cell, to) ? -1 : 1))
  }
  const grip = getTerrainAt(board, from, here).terrain?.climbDL ?? null
  const down = next.filter((f) => below(f) && !next.filter(solid(to)).some((g) => g.floor > f.floor && g.floor - here < FALL.minHeight)).sort((a, b) => b.floor - a.floor).map(at(to, grip))
  if (down.length === 0) return []
  const end = down[down.length - 1]
  const ledges = own.filter((f) => isLedge(board, from, f) && below(f) && f.floor > end.floor).map(at(from, grip))
  return [...down, ...ledges].sort((a, b) => b.floor - a.floor || (sameCell(a.cell, to) ? -1 : 1))
}

// The floor the face the stops are on goes all the way to: the last of them
// going the way the first goes.
function getFaceEnd(stops: ClimbStop[], here: number): ClimbStop | null {
  const first = stops[0]
  return first ? stops.filter((s) => (s.floor > here) === (first.floor > here)).at(-1)! : null
}

// The floor a climb from `here` towards `to` goes all the way to, null where
// there is no face.
export function getClimbBound(board: Board, from: Coord, here: number, to: Coord): ClimbStop | null {
  return getFaceEnd(getClimbStops(board, from, here, to), here)
}

// The floor a climber hanging partway down a face set out from, which they
// may climb back onto (cliff.ts says from how far); null for anyone else.
export function getClimbBack(board: Board, from: Placement): ClimbStop | null {
  if (!from.climb || from.climb.bound >= from.climb.floor) return null
  const floor = getTerrainAt(board, from.cell, from.climb.floor)
  return { ...floor, cell: from.cell, climbDL: floor.terrain?.climbDL ?? null }
}

// The floor a climber hanging on a face, or setting out on one from where they
// stand, is bound for: the stop the move names (`ledge`), or else where a
// hanging climber was bound, or else the end of the face.
export function getClimbTarget(board: Board, from: Placement, to: Coord, ledge: { cell: Coord; floor: number } | null = null): ClimbStop | null {
  if (from.climb && !sameCell(from.climb.to, to)) return null
  const here = from.climb ? from.climb.floor : getTerrainAt(board, from.cell, from.elevation).floor
  const back = getClimbBack(board, from)
  if (back && ledge && sameCell(back.cell, ledge.cell) && back.floor === ledge.floor) return back
  const stops = getClimbStops(board, from.cell, here, to)
  const chosen = ledge ? stops.find((s) => sameCell(s.cell, ledge.cell) && s.floor === ledge.floor) : null
  if (ledge) return chosen ?? null
  const kept = from.climb ? stops.find((s) => s.floor === from.climb!.bound && sameCell(s.cell, to)) ?? stops.find((s) => s.floor === from.climb!.bound) : null
  return kept ?? getFaceEnd(stops, here)
}

// A placement moved to `cell`, on the floor there its feet reach from the
// height they are at (combat.tex "High Ground"); off any board, the ground is
// at 0.
export function placeAt(board: Board | null, placement: Placement, cell: Coord): Placement {
  return { ...placement, cell, elevation: board ? getTerrainAt(board, cell, placement.elevation).floor : 0, climb: null }
}

// The fight with the given characters standing elsewhere, for reading what
// would hold there; unchanged on a fight without a board.
export function withPlacements(state: SceneState, placements: Board['placements']): SceneState {
  return state.board ? { ...state, board: { ...state.board, placements: { ...state.board.placements, ...placements } } } : state
}

// The fight with these characters' tokens taken off the board, the board
// left as it is.
export function withoutPlacements(state: SceneState, ids: string[]): SceneState {
  return state.board ? { ...state, board: { ...state.board, placements: ids.reduce(without, state.board.placements) } } : state
}

export function getPlacedFootprint(state: SceneState, id: string): Coord[] | null {
  const placement = state.board?.placements[id]
  const c = state.characters[id]
  return placement && c ? getFootprint(c, placement) : null
}

// Cells between two characters, edge to edge: 0 when they share a cell, 1
// when adjacent — or the metres a chase puts between them (a cell is a
// metre).
export function getDistanceBetween(state: SceneState, a: string, b: string): number | null {
  const apart = getChaseDistance(state, a, b)
  if (apart !== null) return apart
  const fa = getPlacedFootprint(state, a)
  const fb = getPlacedFootprint(state, b)
  return fa && fb ? setDistance(fa, fb) : null
}

// A character as a melee weapon meets them: the cells they cover and the
// metres from their feet to their feet and their height.
export type Body = { footprint: Coord[]; feet: number; height: number }

export function getBodyAt(c: Character, placement: Placement): Body {
  return { footprint: getFootprint(c, placement), feet: placement.elevation, height: getHeight(c) }
}

export function getBody(state: SceneState, id: string): Body | null {
  const placement = state.board?.placements[id]
  const c = state.characters[id]
  return placement && c ? getBodyAt(c, placement) : null
}

// The chord-wall rulings: the fewest cells across from one body to the other
// along a line from a cell of one to a cell of the other that crosses nothing
// a blow cannot pass (what stops a shot, `firesAcross`), drawn from the
// middle of one body's height to the other's; Infinity when every line is
// stopped.
const blows = new WeakMap<Board, Map<string, boolean>>()
function getOpenDistance(board: Board | null, a: Body, b: Body): number {
  if (!board) return setDistance(a.footprint, b.footprint)
  const eyes = board.levels.length ? { from: a.feet + a.height / 2, to: b.feet + b.height / 2 } : LEVEL_EYES
  const known = blows.get(board) ?? new Map<string, boolean>()
  blows.set(board, known)
  const stopped = (x: Coord, y: Coord) => {
    const key = `${coordKey(x)}|${coordKey(y)}|${eyes.from}|${eyes.to}`
    const met = known.get(key) ?? stoppedBetween(board, x, y, eyes, (t) => t.blocking)
    known.set(key, met)
    return met
  }
  const pairs = a.footprint.flatMap((x) => b.footprint.map((y) => ({ x, y, cells: distance(x, y) }))).sort((p, q) => p.cells - q.cells)
  return pairs.find((p) => !stopped(p.x, p.y))?.cells ?? Infinity
}

// How far a melee weapon has to reach from one body to the other on the
// board: the cells across along a line no wall stops (`getOpenDistance`), or
// the metres up or down between them counted as cells are, bodies that touch
// a cell apart and bodies side by side in height none, whichever is the
// farther. A character reaches as high as their feet and their height, and a
// weapon a metre more for every cell of reach past the first.
export function getMeleeGap(board: Board | null, a: Body, b: Body): number {
  const gap = Math.max(a.feet - (b.feet + b.height), b.feet - (a.feet + a.height))
  return Math.max(getOpenDistance(board, a, b), gap < 0 ? 0 : gap + 1)
}

// The melee distance between two characters as they stand, or what a chase
// puts between them.
export function getMeleeDistance(state: SceneState, a: string, b: string): number | null {
  const apart = getChaseDistance(state, a, b)
  if (apart !== null) return apart
  const [ba, bb] = [getBody(state, a), getBody(state, b)]
  return ba && bb ? getMeleeGap(state.board, ba, bb) : null
}

// Everyone standing next to the character: within a cell, edge to edge, with
// no wall between (`getOpenDistance`), or a metre apart in a chase.
export function getAdjacentIds(state: SceneState, id: string): string[] {
  const body = getBody(state, id)
  return Object.keys(state.characters).filter((other) => {
    if (other === id) return false
    const apart = getChaseDistance(state, id, other)
    const near = getBody(state, other)
    const distance = apart ?? (body && near ? getOpenDistance(state.board, body, near) : null)
    return distance !== null && distance <= 1
  })
}

// ---------------------------------------------------------------------------
// Reach

// gear.tex "Short, Long I/II" and "Scaling weapons" ("multiply ... reach by
// the RM"): a melee attack's reach in metres, which is cells, at the
// weapon's own size, and never short of the next cell.
export function getReach(weapon: Weapon, range: MeleeRange): number {
  return Math.max(1, REACH[range] * RMArr[weapon.scale - 1])
}

// The height of the ground someone stands on; a climber hanging on a face
// stands on none.
function getStanding(state: SceneState, placement: Placement): number {
  return placement.climb ? placement.climb.floor : placement.elevation
}

// combat.tex "High Ground": "standing on terrain around 1m higher than its
// surroundings". Positive when `a` stands above `b`.
function getElevationDifference(state: SceneState, a: string, b: string): number | null {
  const pa = state.board?.placements[a]
  const pb = state.board?.placements[b]
  return pa && pb ? getStanding(state, pa) - getStanding(state, pb) : null
}

export function isHighGround(state: SceneState, a: string, b: string): boolean {
  const diff = getElevationDifference(state, a, b)
  return diff !== null && Math.abs(diff) >= 1
}

// The reach of the strike as declared, against its target: the row's reach
// at the weapon's scale, never under a cell, less combat.tex "High Ground":
// "The melee reach is reduced by 1m unless the person on the lower ground
// targets the legs. The one on the high ground has the reach reduced to hit
// the legs of someone on the lower ground." Null while the row is not
// declared.
export function getStrikeReach(state: SceneState, action: StrikeAction): number | null {
  const attacker = state.characters[action.actorId]
  const row = attacker ? findWeaponRow(attacker, action.weaponKey, action.attack) : null
  if (!row || !isMeleeRange(row.atk.range)) return null
  let reach = getReach(row.weapon, row.atk.range)
  const diff = action.targetId ? getElevationDifference(state, action.actorId, action.targetId) : null
  if (diff !== null && Math.abs(diff) >= 1) {
    const targetsLegs = action.location === 'leg'
    if (diff < 0 && !targetsLegs) reach -= 1
    if (diff > 0 && targetsLegs) reach -= 1
  }
  return reach
}

// Whether the strike can land on the target from where its actor stands.
export function isInReach(state: SceneState, action: StrikeAction, targetId: string): boolean {
  const distance = getMeleeDistance(state, action.actorId, targetId)
  if (distance === null) return true
  const reach = getStrikeReach(state, { ...action, targetId })
  return reach === null || distance <= reach
}

// ---------------------------------------------------------------------------
// Shots

// combat.tex "Cover": "A character has cover if the shortest path from the
// origin of the ... projectile to a destination passes through a space
// containing a blocking object. Cover blocks vision unless it is
// transparent." The line between two cells climbs or falls from the height of
// one end to the other's, so a storey's wall stops it only within that
// storey's metres, and a floor stops it where it goes up or down through it.
export type Eyes = { from: number; to: number }

// A line with no climb, which is how a board without storeys is read.
export const LEVEL_EYES: Eyes = { from: 0, to: 0 }

// A character's eyes are as high as their feet and their height.
export function getEyeHeight(state: SceneState, id: string): number {
  const c = state.characters[id]
  return (state.board?.placements[id]?.elevation ?? 0) + (c ? getHeight(c) : 0)
}

// The line from one character's eyes to another's.
export function getEyes(state: SceneState, a: string, b: string): Eyes {
  return state.board?.levels.length ? { from: getEyeHeight(state, a), to: getEyeHeight(state, b) } : LEVEL_EYES
}

// The line from a character's eyes to the eyes of someone as tall standing on
// a floor `floor` high.
export function getEyesToward(state: SceneState, id: string, floor: number): Eyes {
  const c = state.characters[id]
  return state.board?.levels.length ? { from: getEyeHeight(state, id), to: floor + (c ? getHeight(c) : 0) } : LEVEL_EYES
}

// What a floor is to a line that goes through it: a wall nothing breaks.
const FLOOR: TerrainCell = TerrainCellSchema.parse({ blocking: true })

// Whether `stops` holds of something in the cell for a line `centre` high in
// the middle of it that rises or falls `reach` to either side. A wall is met
// at the middle, so that a pane fills its storey sill included; a floor is
// gone through, which a cell with a wall has no floor of its own to be.
function holds(board: Board, key: string, centre: number, reach: number, stops: (t: TerrainCell) => boolean): boolean {
  const ground = board.terrain[key]
  const ceiling = Math.min(Infinity, ...board.levels.filter((l) => l.terrain[key]).map((l) => getStoreyFloor(l, l.terrain[key])))
  if (ground && centre < ceiling && stops(ground)) return true
  return board.levels.some((level) => {
    const here = level.terrain[key]
    if (!here) return false
    const floor = getStoreyFloor(level, here)
    const goesThrough = !here.hole && !here.lattice && !here.blocking && Math.abs(floor - centre) <= reach
    return (goesThrough && stops(FLOOR)) || (floor <= centre && centre < level.floor + level.height && stops(here))
  })
}

// The thin walls a cell stands, each where it lies in the plane: on the
// chords that cut its corners off. Everything that meets a thin wall, and the
// drawing of one, reads them here.
export function getThinWallsOf(cell: Coord, t: TerrainCell | undefined): { key: string; ends: [{ x: number; y: number }, { x: number; y: number }] }[] {
  if (!t) return []
  return t.chords.map((corner) => ({ key: `chord${corner}`, ends: getChordAt(cell, corner) }))
}

// Whether the cell stands a thin wall.
export function hasThinWalls(t: TerrainCell | undefined): boolean {
  return !!t && t.chords.length > 0
}

// A thin wall where it stands: its chord in the plane, the heights it rises
// between, and what a line meets in it, a wall of its cell's stuff.
type ThinWall = { ends: [{ x: number; y: number }, { x: number; y: number }]; low: number; high: number; wall: TerrainCell }

// The thin walls of the board, each standing from its floor up to the storey
// laid over it (on the ground, as a wall of the ground does: no foot, up to
// the lowest storey), or through its own storey's height.
const thinWalls = new WeakMap<Board, ThinWall[]>()
function getThinWalls(board: Board): ThinWall[] {
  const known = thinWalls.get(board)
  if (known) return known
  const walls: ThinWall[] = []
  const lay = (cell: Coord, t: TerrainCell, low: number, high: number) => {
    for (const { ends } of getThinWallsOf(cell, t)) walls.push({ ends, low, high, wall: { ...t, blocking: true } })
  }
  for (const [key, ground] of Object.entries(board.terrain)) {
    const cell = parseCoordKey(key)
    if (!cell || !hasThinWalls(ground)) continue
    lay(cell, ground, -Infinity, Math.min(Infinity, ...board.levels.filter((l) => l.terrain[key]).map((l) => getStoreyFloor(l, l.terrain[key]))))
  }
  for (const level of board.levels) {
    for (const [key, here] of Object.entries(level.terrain)) {
      const cell = parseCoordKey(key)
      if (cell && hasThinWalls(here)) lay(cell, here, getStoreyFloor(level, here), level.floor + level.height)
    }
  }
  thinWalls.set(board, walls)
  return walls
}

// The chord-wall rulings: a line is met by a thin wall where it crosses the
// chord, in the cells it ends in too, at the height it has there.
function crossesThinWall(board: Board, a: Coord, b: Coord, eyes: Eyes, stops: (t: TerrainCell) => boolean): boolean {
  const walls = getThinWalls(board)
  if (walls.length === 0 || sameCell(a, b)) return false
  const [p, q] = [toPlane(a), toPlane(b)]
  return walls.some((w) => {
    const t = crossingAt(p, q, w.ends[0], w.ends[1])
    const height = t === null ? 0 : eyes.from + (eyes.to - eyes.from) * t
    return t !== null && w.low <= height && height < w.high && stops(w.wall)
  })
}

// Whether `stops` holds of anything the line from `a` to `b` crosses: the
// cells between the ends, and the thin walls of any cell.
function stoppedBetween(board: Board, a: Coord, b: Coord, eyes: Eyes, stops: (t: TerrainCell) => boolean): boolean {
  const cells = line(a, b)
  const slope = (eyes.to - eyes.from) / (cells.length - 1)
  return cells.slice(1, -1).some((cell, k) => holds(board, coordKey(cell), eyes.from + slope * (k + 1), Math.abs(slope) / 2, stops)) || crossesThinWall(board, a, b, eyes, stops)
}

// Whether a step from a cell to its neighbour crosses a thin wall of either
// standing on the floor it is taken on (`floor` gives the footing of each).
export function isStepWalled(floor: (cell: Coord) => TerrainCell | undefined, from: Coord, to: Coord): boolean {
  const [p, q] = [toPlane(from), toPlane(to)]
  return [from, to].some((cell) => getThinWallsOf(cell, floor(cell)).some(({ ends: [a, b] }) => crossingAt(p, q, a, b) !== null))
}

// Whether some cell of one set sees some cell of the other: a line between
// them crossing no opaque blocking cell.
export function seesAcross(board: Board, from: readonly Coord[], to: readonly Coord[], eyes: Eyes): boolean {
  return from.some((a) => to.some((b) => !stoppedBetween(board, a, b, eyes, (t) => t.blocking && !t.transparent)))
}

// Whether what is shot or thrown from some cell of one set can reach some cell
// of the other: a line between them crossing no blocking cell, transparent or
// not — glass is seen through and stops the projectile all the same.
export function firesAcross(board: Board, from: readonly Coord[], to: readonly Coord[], eyes: Eyes): boolean {
  return from.some((a) => to.some((b) => !stoppedBetween(board, a, b, eyes, (t) => t.blocking)))
}

// combat.tex "Cover": what stands in the way of something shot or blown at a
// target — total cover, which nothing gets past, or a wall that breaks, which
// "acts as a shield, absorbing the damage taken by a certain amount based on
// RES of the cover".
export type Cover = { kind: 'total' } | { kind: 'wall'; RES: number }

// What the ground puts between some cell of one set and the other, along the
// most open line of fire between them: a line is met by the sturdiest wall
// on it, a wall nothing breaks stopping it. Null when some line crosses
// nothing.
export function getCoverAcross(board: Board, from: readonly Coord[], to: readonly Coord[], eyes: Eyes): Cover | null {
  let weakest = Infinity
  for (const a of from) {
    for (const b of to) {
      let RES = -Infinity
      stoppedBetween(board, a, b, eyes, (t) => {
        if (t.blocking) RES = Math.max(RES, t.RES ?? Infinity)
        return false
      })
      if (RES === -Infinity) return null
      weakest = Math.min(weakest, RES)
    }
  }
  return weakest === Infinity ? { kind: 'total' } : { kind: 'wall', RES: weakest }
}

// The wall that breaks a blow carries to its target (`Damage.wall`).
export function toDamageWall(cover: Cover | null): Damage['wall'] {
  return cover?.kind === 'wall' ? { RES: cover.RES } : null
}

// Whether something can be aimed at the cell by the actor: within `reach` of
// some cell of their footprint, off blocking ground, and with a line to it
// that `across` lets through, level with their eyes since a cell has no
// height of its own. Sight, or for what is thrown or shot there, fire
// (combat.tex "Cover").
export type Across = typeof seesAcross

export function isAimableCell(state: SceneState, actorId: string, reach: number, cell: Coord, across: Across): boolean {
  const board = state.board
  const footprint = getPlacedFootprint(state, actorId)
  if (!board || !footprint) return false
  return setDistance([cell], footprint) <= reach && !board.terrain[coordKey(cell)]?.blocking && across(board, footprint, [cell], getEyes(state, actorId, actorId))
}

// Every cell around the actor something can be aimed at within `reach`.
export function getAimableCells(state: SceneState, actorId: string, reach: number, across: Across): Coord[] {
  const from = state.board?.placements[actorId]
  return from ? disk(from.cell, reach).filter((cell) => isAimableCell(state, actorId, reach, cell, across)) : []
}

// combat.tex "Cover": "When using a body shield, it is possible to take total
// cover behind the shield after using guard." The shield faces the shot
// that was guarded, or the cell it was planted facing, so it covers its
// bearer from whatever lies on that side of them (`getBodyCoverToward`). A
// footprint level with them, or behind, is not covered from.
export function isBehindBodyShield(state: SceneState, id: string, from: readonly Coord[]): boolean {
  const toward = getBodyCoverToward(state, id)
  const footprint = getPlacedFootprint(state, id)
  if (!toward || !footprint || from.length === 0) return false
  const at = centroid(footprint)
  const source = centroid(from)
  if (Math.hypot(source.x - at.x, source.y - at.y) < 1e-9) return false
  return angularGap(angleBetween(at, toPlane(toward)), angleBetween(at, source)) < Math.PI / 2 - 1e-9
}

// The cell the body shield the character has taken cover behind faces, while
// they still hold it, or while they stand where they planted one that is not
// broken (abilities.tex "Crossbow and Shield": "planted like a cover against
// everything in a 180 degree arc"); null when they are in no such cover.
export function getBodyCoverToward(state: SceneState, id: string): Coord | null {
  const cover = state.bodyCover[id]
  const c = state.characters[id]
  if (!c) return null
  if (cover && getWieldedWeapons(c).some((w) => w.key === cover.weaponKey && !w.broken && w.weapon.shield?.body)) return cover.toward
  const footprint = getPlacedFootprint(state, id)
  const planted = footprint && state.floor.find((f) => f.planted?.by === id && !f.item.broken && f.cell !== null && footprint.some((cell) => sameCell(cell, f.cell!)))
  return planted ? planted.planted!.toward : null
}

// What stands between the cells something is shot or blown from and the
// character: a body shield they are behind, or the ground. Null on a fight
// without a board, or with nothing in the way.
export function getCover(state: SceneState, from: readonly Coord[], targetId: string, eyes: Eyes): Cover | null {
  const board = state.board
  const footprint = getPlacedFootprint(state, targetId)
  if (!board || !footprint) return null
  return isBehindBodyShield(state, targetId, from) ? { kind: 'total' } : getCoverAcross(board, from, footprint, eyes)
}

// Whether some cell of one character's footprint sees some cell of the
// other's, and the other is not behind a body shield from there (combat.tex
// "Cover": total cover "blocks vision"). True on a fight without a board.
export function hasLineOfSight(state: SceneState, a: string, b: string): boolean {
  const board = state.board
  const fa = getPlacedFootprint(state, a)
  const fb = getPlacedFootprint(state, b)
  if (!board || !fa || !fb) return true
  return seesAcross(board, fa, fb, getEyes(state, a, b)) && !isBehindBodyShield(state, b, fa)
}

// Whether what one character shoots can reach the other: they are not in
// total cover from them — a wall that breaks lets the shot through, to be
// absorbed. True on a fight without a board.
export function hasLineOfFire(state: SceneState, a: string, b: string): boolean {
  const fa = getPlacedFootprint(state, a)
  return !fa || getCover(state, fa, b, getEyes(state, a, b))?.kind !== 'total'
}

// The metres the shot as declared carries: the variation's reach for this
// shooter and weapon (combat.tex "Shoot", "Quick Shot", "Snipe"; "Throw").
// Null while the row or the variation is not declared.
export function getShotReachOf(state: SceneState, action: ShootAction): number | null {
  const shooter = state.characters[action.actorId]
  const row = shooter ? findWeaponRow(shooter, action.weaponKey, action.attack) : null
  if (!shooter || !row) return null
  return findRowVariant(shooter, row, action.variant)?.reach ?? null
}

// combat.tex "Guard": "block ranged attacks against themselves or adjacent
// characters, as long as they are closer to the projectile source than the
// adjacent character" — the target always; someone adjacent by where the
// shot comes from, so each of several shots at one target has its own
// guards; in a chase, the target's party (rules/chase.ts).
export function isGuardingShot(state: SceneState, shooterId: string, targetId: string, guardId: string): boolean {
  if (guardId === shooterId) return false
  if (guardId === targetId || isChaseMate(state, guardId, targetId)) return true
  if (!getAdjacentIds(state, targetId).includes(guardId)) return false
  const toGuard = getDistanceBetween(state, shooterId, guardId)
  const toTarget = getDistanceBetween(state, shooterId, targetId)
  return toGuard !== null && toTarget !== null && toGuard < toTarget
}

// The same for a shot aimed at the ground: whoever stands next to the cells
// and closer to the shooter than they are.
export function isGuardingCells(state: SceneState, shooterId: string, cells: Coord[], guardId: string): boolean {
  const shooter = getPlacedFootprint(state, shooterId)
  const guard = getPlacedFootprint(state, guardId)
  return guardId !== shooterId && !!shooter && !!guard && setDistance(guard, cells) <= 1 && setDistance(shooter, guard) < setDistance(shooter, cells)
}

// Whether the shot can land on the target from where its actor stands: the
// target within the shot's reach and out of total cover from them — across
// a chase's tiers, a shot whose range names the tier or a farther one.
export function isInShotRange(state: SceneState, action: ShootAction, targetId: string): boolean {
  const tier = getChaseTierBetween(state, action.actorId, targetId)
  if (tier && tier !== 'combat') {
    const row = state.characters[action.actorId] ? findWeaponRow(state.characters[action.actorId], action.weaponKey, action.attack) : null
    return !row || reachesTier(row.atk.range, tier)
  }
  const distance = getDistanceBetween(state, action.actorId, targetId)
  if (distance === null) return true
  const reach = getShotReachOf(state, action)
  return (reach === null || distance <= reach) && hasLineOfFire(state, action.actorId, targetId)
}

// ---------------------------------------------------------------------------
// Flanking

// The farthest any melee row in the character's hands can strike — or any
// row `fits` accepts, when it is given — never under a cell; 0 with nothing
// to strike with.
export function getMeleeRange(c: Character, fits: (atk: WeaponAttack) => boolean = () => true): number {
  return Math.max(0, ...getWeaponRows(c).flatMap((row) =>
    isRowUsable(c, row) && isMeleeRange(row.atk.range) && fits(row.atk) ? [getReach(row.weapon, row.atk.range)] : [],
  ))
}

// combat.tex "Flanking": "when more than one character is within melee
// range, any attack against one of the surrounding characters triggers an
// attack of opportunity from the others, provided that they cannot be fit
// within a semi-circle centered on the triggering attack's target." The
// others who get that attack: everyone with the attacker in their own melee
// range, standing more than a quarter turn off the attacker's line to the
// target. Nobody, on a fight without a board.
export function getFlankers(state: SceneState, attackerId: string, targetId: string): string[] {
  const attacker = getBody(state, attackerId)
  const target = getPlacedFootprint(state, targetId)
  if (!attacker || !target) return []
  const center = centroid(attacker.footprint)
  const toTarget = angleBetween(center, centroid(target))
  return Object.keys(state.characters).filter((id) => {
    if (id === attackerId || id === targetId) return false
    const other = state.characters[id]
    const body = getBody(state, id)
    if (!body || getMeleeGap(state.board, body, attacker) > getMeleeRange(other)) return false
    return angularGap(toTarget, angleBetween(center, centroid(body.footprint))) > Math.PI / 2 + 1e-9
  })
}

// combat.tex "Opportunity Attack": a triggering action is answered by anyone
// who threatens the one attempting it with a melee weapon — everyone with
// them in their own melee range, whatever the board.
export function getMeleeThreateners(state: SceneState, id: string, reachOf: (c: Character) => number = getMeleeRange): string[] {
  const body = getBody(state, id)
  if (!body) return []
  return Object.keys(state.characters).filter((other) => {
    if (other === id) return false
    const otherBody = getBody(state, other)
    return !!otherBody && getMeleeGap(state.board, otherBody, body) <= reachOf(state.characters[other])
  })
}
