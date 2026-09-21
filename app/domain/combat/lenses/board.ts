import type { Character, MeleeRange, Weapon } from '../../types'
import type { Board, CombatState, Coord, Placement, StrikeAction } from '../types'
import { FOOTPRINTS, FOOTPRINT_CELLS, REACH, RMArr } from '../../tables'
import { getSize } from '../../character/lenses/misc'
import { isMeleeRange } from '../../weaponProperties'
import { getWieldedWeapons } from '../../item/lenses/hands'
import { add, coordKey, rotate, setDistance } from '../geometry'

// The board lenses read the spatial facts of a fight off `state.board`.
// Every lens that answers for a fight answers null, or "passes", when the
// fight has no board or the character asked about is not placed on it: the
// domain does not know where anyone stands, so no positional rule can close
// anything.

// ---------------------------------------------------------------------------
// Footprints

// creating.tex "Size and Space Occupation": the cells a character covers
// around its anchor, before it is placed: its shape at its size's cell count,
// in orientation 0.
export function getShapeCells(c: Character): readonly Coord[] {
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
export function getElevationDifference(state: CombatState, a: string, b: string): number | null {
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
  const wielded = attacker ? getWieldedWeapons(attacker).find((w) => w.key === action.weaponKey) : undefined
  const atk = wielded?.weapon.attacks.find((a) => a.name === action.attack)
  if (!wielded || !atk || !isMeleeRange(atk.range)) return null
  let reach = Math.max(1, getReach(wielded.weapon, atk.range))
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
// Flanking

// The farthest any melee row in the character's hands can strike, never
// under a cell; 0 with nothing to strike with.
export function getMeleeRange(c: Character): number {
  return Math.max(0, ...getWieldedWeapons(c).flatMap((w) =>
    w.weapon.attacks.flatMap((a) => (isMeleeRange(a.range) ? [Math.max(1, getReach(w.weapon, a.range))] : [])),
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

function angleBetween(from: { x: number; y: number }, to: { x: number; y: number }): number {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  return angle < 0 ? angle + 2 * Math.PI : angle
}

// The smaller turn between two directions.
function angularGap(a: number, b: number): number {
  const gap = Math.abs(a - b) % (2 * Math.PI)
  return Math.min(gap, 2 * Math.PI - gap)
}
