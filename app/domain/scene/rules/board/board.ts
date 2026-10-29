import type { Character, Damage, MeleeRange, Weapon, WeaponAttack } from '../../../types'
import type { Board, BoardExtent, SceneState, Coord, Placement, ShootAction, StrikeAction, TerrainCell } from '../../types'
import { TerrainCellSchema } from '../../types'
import { getHeight } from '../../../character/rules/size'
import { FALL, REACH, RMArr } from '../../../tables'
import { isMeleeRange } from '../../../weaponProperties'
import { getWieldedWeapons } from '../../../item/rules/hands'
import { add, angleBetween, angularGap, centroid, coordKey, disk, inExtent, line, parseCoordKey, rotate, sameCell, setDistance, toPlane } from './geometry'
import { findRowVariant, findWeaponRow, getWeaponRows, isRowUsable } from '../weaponRow'
import { getChaseDistance, getChaseTierBetween, isChaseMate, reachesTier } from '../chase'
import { without } from '../../../utils'

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
export function getBeyondEdge(state: SceneState, extent: BoardExtent): { characters: string[]; floor: string[]; terrain: string[] } {
  const board = state.board
  if (!board) return { characters: [], floor: [], terrain: [] }
  const beyond = (cell: Coord) => !inExtent(board.origin, extent, cell)
  return {
    characters: Object.entries(board.placements).filter(([id, p]) => state.characters[id] && getFootprint(state.characters[id], p).some(beyond)).map(([id]) => id),
    floor: state.floor.filter((f) => f.cell !== null && beyond(f.cell)).map((f) => f.item.id),
    terrain: Object.keys(board.terrain).filter((key) => { const cell = parseCoordKey(key); return cell === null || beyond(cell) }),
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

// The floor someone whose feet are at `height` stands on in the cell: the
// highest there that is no cliff above them (combat.tex "Choosing Fall DL":
// a cliff is a metre or more), the ground or a storey's floor that is not a
// hole, or the lowest where every floor is. A walk up a stair is ground under
// a stairwell rising less than a cliff a step until it meets the storey.
export function getTerrainAt(board: Board, cell: Coord, height: number): Footing {
  const key = coordKey(cell)
  const ground = board.terrain[key]
  if (board.levels.length === 0) return { terrain: ground, floor: ground?.elevation ?? 0, level: null }
  const floors: Footing[] = [
    { terrain: ground, floor: ground?.elevation ?? 0, level: null },
    ...board.levels.flatMap((l, level) => (l.terrain[key] && !l.terrain[key].hole ? [{ terrain: l.terrain[key], floor: l.floor, level }] : [])),
  ]
  const reached = floors.filter((f) => f.floor - height < FALL.minHeight)
  return reached.length > 0
    ? reached.reduce((a, b) => (b.floor > a.floor ? b : a))
    : floors.reduce((a, b) => (b.floor < a.floor ? b : a))
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
// metre). A metre between their feet up or down is as far as a cell across,
// and the farther of the two is the distance.
export function getDistanceBetween(state: SceneState, a: string, b: string): number | null {
  const apart = getChaseDistance(state, a, b)
  if (apart !== null) return apart
  const fa = getPlacedFootprint(state, a)
  const fb = getPlacedFootprint(state, b)
  const rise = Math.abs((state.board?.placements[a]?.elevation ?? 0) - (state.board?.placements[b]?.elevation ?? 0))
  return fa && fb ? Math.max(setDistance(fa, fb), rise) : null
}

// Everyone standing next to the character: within a cell, edge to edge.
export function getAdjacentIds(state: SceneState, id: string): string[] {
  return Object.keys(state.characters).filter((other) => {
    if (other === id) return false
    const distance = getDistanceBetween(state, id, other)
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
  return placement.climb ? state.board?.terrain[coordKey(placement.cell)]?.elevation ?? 0 : placement.elevation
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
  const distance = getDistanceBetween(state, action.actorId, targetId)
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
function getEyeHeight(state: SceneState, id: string): number {
  const c = state.characters[id]
  return (state.board?.placements[id]?.elevation ?? 0) + (c ? getHeight(c) : 0)
}

// The line from one character's eyes to another's.
export function getEyes(state: SceneState, a: string, b: string): Eyes {
  return state.board?.levels.length ? { from: getEyeHeight(state, a), to: getEyeHeight(state, b) } : LEVEL_EYES
}

// What a floor is to a line that goes through it: a wall nothing breaks.
const FLOOR: TerrainCell = TerrainCellSchema.parse({ blocking: true })

// Whether `stops` holds of something in the cell for a line `centre` high in
// the middle of it that rises or falls `reach` to either side. A wall is met
// at the middle, so that a pane fills its storey sill included; a floor is
// gone through, which a cell with a wall has no floor of its own to be.
function holds(board: Board, key: string, centre: number, reach: number, stops: (t: TerrainCell) => boolean): boolean {
  const ground = board.terrain[key]
  const ceiling = Math.min(Infinity, ...board.levels.filter((l) => l.terrain[key]).map((l) => l.floor))
  if (ground && centre < ceiling && stops(ground)) return true
  return board.levels.some((level) => {
    const here = level.terrain[key]
    if (!here) return false
    const goesThrough = !here.hole && !here.blocking && Math.abs(level.floor - centre) <= reach
    return (goesThrough && stops(FLOOR)) || (level.floor <= centre && centre < level.floor + level.height && stops(here))
  })
}

// Whether `stops` holds of anything the line from `a` to `b` crosses, the
// ends left out.
function stoppedBetween(board: Board, a: Coord, b: Coord, eyes: Eyes, stops: (t: TerrainCell) => boolean): boolean {
  const cells = line(a, b)
  const slope = (eyes.to - eyes.from) / (cells.length - 1)
  return cells.slice(1, -1).some((cell, k) => holds(board, coordKey(cell), eyes.from + slope * (k + 1), Math.abs(slope) / 2, stops))
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
  const attacker = getPlacedFootprint(state, attackerId)
  const target = getPlacedFootprint(state, targetId)
  if (!attacker || !target) return []
  const center = centroid(attacker)
  const toTarget = angleBetween(center, centroid(target))
  return Object.keys(state.characters).filter((id) => {
    if (id === attackerId || id === targetId) return false
    const other = state.characters[id]
    const footprint = getPlacedFootprint(state, id)
    if (!footprint || setDistance(footprint, attacker) > getMeleeRange(other)) return false
    return angularGap(toTarget, angleBetween(center, centroid(footprint))) > Math.PI / 2 + 1e-9
  })
}

// combat.tex "Opportunity Attack": a triggering action is answered by anyone
// who threatens the one attempting it with a melee weapon — everyone with
// them in their own melee range, whatever the board.
export function getMeleeThreateners(state: SceneState, id: string, reachOf: (c: Character) => number = getMeleeRange): string[] {
  const footprint = getPlacedFootprint(state, id)
  if (!footprint) return []
  return Object.keys(state.characters).filter((other) => {
    if (other === id) return false
    const otherFootprint = getPlacedFootprint(state, other)
    return !!otherFootprint && setDistance(otherFootprint, footprint) <= reachOf(state.characters[other])
  })
}
