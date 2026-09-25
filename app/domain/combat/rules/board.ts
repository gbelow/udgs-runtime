import type { Character, MeleeRange, Weapon, WeaponProperty } from '../../types'
import type { Board, CombatState, Coord, ExplosionAction, Placement, ShootAction, StrikeAction } from '../types'
import { FOOTPRINTS, FOOTPRINT_CELLS, REACH, RMArr } from '../../tables'
import { getSize } from '../../character/rules/misc'
import { getAttacksList } from '../../character/rules/gear'
import { hasProperty, isMeleeRange } from '../../weaponProperties'
import { getWieldedWeapons } from '../../item/rules/hands'
import { add, coordKey, line, rotate, setDistance } from '../geometry'
import { findWeaponRow } from './weaponRow'

// The board rules read the spatial facts of a fight off `state.board`.
// Every rule that answers for a fight answers null, or "passes", when the
// fight has no board or the character asked about is not placed on it: the
// domain does not know where anyone stands, so no positional rule can close
// anything.

// ---------------------------------------------------------------------------
// Footprints

// creating.tex "Size and Space Occupation": the cells a character covers
// around its anchor, before it is placed: its shape at its size's cell count,
// in orientation 0.
function getShapeCells(c: Character): readonly Coord[] {
  return FOOTPRINTS[c.shape][FOOTPRINT_CELLS[getSize(c) - 1]]
}

// The cells a placed character covers on the board: its shape turned to the
// placement's orientation and moved to its anchor.
export function getFootprint(c: Character, placement: Placement): Coord[] {
  return getShapeCells(c).map((offset) => add(placement.cell, rotate(offset, placement.orientation)))
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

// A placement moved to `cell`, at the height of the ground there (combat.tex
// "High Ground"); off any board, the ground is at 0.
export function placeAt(board: Board | null, placement: Placement, cell: Coord): Placement {
  return { ...placement, cell, elevation: board?.terrain[coordKey(cell)]?.elevation ?? 0 }
}

// The fight with the given characters standing elsewhere, for reading what
// would hold there; unchanged on a fight without a board.
export function withPlacements(state: CombatState, placements: Board['placements']): CombatState {
  return state.board ? { ...state, board: { ...state.board, placements: { ...state.board.placements, ...placements } } } : state
}

export function getPlacedFootprint(state: CombatState, id: string): Coord[] | null {
  const placement = state.board?.placements[id]
  const c = state.characters[id]
  return placement && c ? getFootprint(c, placement) : null
}

// Cells between two characters, edge to edge: 0 when they share a cell, 1
// when adjacent.
export function getDistanceBetween(state: CombatState, a: string, b: string): number | null {
  const fa = getPlacedFootprint(state, a)
  const fb = getPlacedFootprint(state, b)
  return fa && fb ? setDistance(fa, fb) : null
}

// Everyone standing next to the character: within a cell, edge to edge.
export function getAdjacentIds(state: CombatState, id: string): string[] {
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
// weapon's own size.
export function getReach(weapon: Weapon, range: MeleeRange): number {
  return REACH[range] * RMArr[weapon.scale - 1]
}

// combat.tex "High Ground": "standing on terrain around 1m higher than its
// surroundings". Positive when `a` stands above `b`.
function getElevationDifference(state: CombatState, a: string, b: string): number | null {
  const pa = state.board?.placements[a]
  const pb = state.board?.placements[b]
  return pa && pb ? pa.elevation - pb.elevation : null
}

export function isHighGround(state: CombatState, a: string, b: string): boolean {
  const diff = getElevationDifference(state, a, b)
  return diff !== null && Math.abs(diff) >= 1
}

// The reach of the strike as declared, against its target: the row's reach
// at the weapon's scale, never under a cell, less combat.tex "High Ground":
// "The melee reach is reduced by 1m unless the person on the lower ground
// targets the legs. The one on the high ground has the reach reduced to hit
// the legs of someone on the lower ground." Null while the row is not
// declared.
export function getStrikeReach(state: CombatState, action: StrikeAction): number | null {
  const attacker = state.characters[action.actorId]
  const row = attacker ? findWeaponRow(attacker, action.weaponKey, action.attack) : null
  if (!row || !isMeleeRange(row.atk.range)) return null
  let reach = Math.max(1, getReach(row.weapon, row.atk.range))
  const diff = action.targetId ? getElevationDifference(state, action.actorId, action.targetId) : null
  if (diff !== null && Math.abs(diff) >= 1) {
    const targetsLegs = action.location === 'leg'
    if (diff < 0 && !targetsLegs) reach -= 1
    if (diff > 0 && targetsLegs) reach -= 1
  }
  return reach
}

// Whether the strike can land on the target from where its actor stands.
export function isInReach(state: CombatState, action: StrikeAction, targetId: string): boolean {
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
// transparent." Whether some cell of one set sees some cell of the other: a
// straight line between them crossing no opaque blocking cell.
export function seesAcross(board: Board, from: readonly Coord[], to: readonly Coord[]): boolean {
  const opaque = (cell: Coord) => {
    const terrain = board.terrain[coordKey(cell)]
    return !!terrain?.blocking && !terrain.transparent
  }
  return from.some((a) => to.some((b) => !line(a, b).slice(1, -1).some(opaque)))
}

// Whether some cell of one character's footprint sees some cell of the
// other's. True on a fight without a board.
export function hasLineOfSight(state: CombatState, a: string, b: string): boolean {
  const board = state.board
  const fa = getPlacedFootprint(state, a)
  const fb = getPlacedFootprint(state, b)
  if (!board || !fa || !fb) return true
  return seesAcross(board, fa, fb)
}

// The metres the shot as declared carries: the variation's reach for this
// shooter and weapon (combat.tex "Shoot", "Quick Shot", "Snipe"; "Throw").
// Null while the row or the variation is not declared.
export function getShotReachOf(state: CombatState, action: ShootAction | ExplosionAction): number | null {
  const shooter = state.characters[action.actorId]
  const row = shooter ? findWeaponRow(shooter, action.weaponKey, action.attack) : null
  if (!shooter || !row) return null
  return getAttacksList({ atk: row.atk, weapon: row.weapon })(shooter).find((v) => v.name === action.variant)?.reach ?? null
}

// Whether the shot can land on the target from where its actor stands: the
// target within the shot's reach and in sight.
export function isInShotRange(state: CombatState, action: ShootAction, targetId: string): boolean {
  const distance = getDistanceBetween(state, action.actorId, targetId)
  if (distance === null) return true
  const reach = getShotReachOf(state, action)
  return (reach === null || distance <= reach) && hasLineOfSight(state, action.actorId, targetId)
}

// ---------------------------------------------------------------------------
// Flanking

// The farthest any melee row in the character's hands can strike — or any
// row with the property, when one is named — never under a cell; 0 with
// nothing to strike with.
export function getMeleeRange(c: Character, property?: WeaponProperty): number {
  return Math.max(0, ...getWieldedWeapons(c).flatMap((w) =>
    w.weapon.attacks.flatMap((a) => (isMeleeRange(a.range) && (!property || hasProperty(a.properties, property)) ? [Math.max(1, getReach(w.weapon, a.range))] : [])),
  ))
}

// combat.tex "Flanking": "when more than one character is within melee
// range, any attack against one of the surrounding characters triggers an
// attack of opportunity from the others, provided that they cannot be fit
// within a semi-circle centered on the triggering attack's target." The
// others who get that attack: everyone with the attacker in their own melee
// range, standing more than a quarter turn off the attacker's line to the
// target. Nobody, on a fight without a board.
export function getFlankers(state: CombatState, attackerId: string, targetId: string): string[] {
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
export function getMeleeThreateners(state: CombatState, id: string): string[] {
  const footprint = getPlacedFootprint(state, id)
  if (!footprint) return []
  return Object.keys(state.characters).filter((other) => {
    if (other === id) return false
    const otherFootprint = getPlacedFootprint(state, other)
    return !!otherFootprint && setDistance(otherFootprint, footprint) <= getMeleeRange(state.characters[other])
  })
}

// ---------------------------------------------------------------------------
// Angles

// Axial to the plane, pointy-top hexes of unit spacing.
export function toPlane(c: Coord): { x: number; y: number } {
  return { x: Math.sqrt(3) * (c.q + c.r / 2), y: 1.5 * c.r }
}

function centroid(cells: readonly Coord[]): { x: number; y: number } {
  const points = cells.map(toPlane)
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  }
}

export function angleBetween(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  return angle < 0 ? angle + 2 * Math.PI : angle
}

// The smaller turn between two directions.
export function angularGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % (2 * Math.PI)
  return Math.min(gap, 2 * Math.PI - gap)
}
