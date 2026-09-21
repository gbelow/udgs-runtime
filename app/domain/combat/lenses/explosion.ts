import type { Area } from '../../types'
import { DEGREES, type CombatState, type Coord, type Degree, type ExplosionAction } from '../types'
import { RMArr } from '../../tables'
import { getAccuracy } from '../../character/lenses/skills'
import { Term } from '../../character/lenses/terms'
import { getWieldedWeapons } from '../../item/lenses/hands'
import { hasProperty } from '../../weaponProperties'
import { DIRECTIONS, add, coordKey, disk, distance, ring, sameCell, setDistance } from '../geometry'
import { angleBetween, angularGap, getPlacedFootprint, getShotReachOf, seesAcross, toPlane } from './board'

// combat.tex "Explosions", "Sprays": where an explosion reaches and how hard
// it hits there. The area is read off the row the action names; the zones
// off where it is aimed; who is in which zone off the board as it stands —
// so the same lenses answer before the reactions move and after.

export type ZoneCell = { cell: Coord; degree: Degree }

// gear.tex "Explosion", "Scaling weapons" ("multiply ... reach by the RM"):
// the area the row as declared covers, in cells at the weapon's scale. Null
// while the row is not declared, or names one that does not explode.
export function getExplosionArea(state: CombatState, action: ExplosionAction): Area | null {
  const attacker = state.characters[action.actorId]
  const wielded = attacker ? getWieldedWeapons(attacker).find((w) => w.key === action.weaponKey) : undefined
  const atk = wielded?.weapon.attacks.find((a) => a.name === action.attack)
  if (!wielded || !atk?.area || !hasProperty(atk.properties, 'explosion')) return null
  const RM = RMArr[wielded.weapon.scale - 1]
  return atk.area.shape === 'explosion'
    ? { shape: 'explosion', radius: Math.floor(atk.area.radius * RM) }
    : { shape: 'spray', length: Math.floor(atk.area.length * RM), angle: atk.area.angle }
}

// combat.tex "Explosions": "Anyone caught in the center of the radius
// receives the critical effect, while those in the middle are hit, and the
// ones in the edge are grazed." The centre cell is the critical zone, the
// outermost ring the graze, every ring between a hit. (Past 5m of radius the
// book lets the table widen the outer zones, 30%/40%/30%; not done here.)
export function getDiskZones(center: Coord, radius: number): ZoneCell[] {
  return Array.from({ length: radius + 1 }, (_, k) =>
    ring(center, k).map((cell): ZoneCell => ({ cell, degree: k === 0 ? 'critical' : k === radius ? 'graze' : 'hit' })),
  ).flat()
}

// combat.tex "Sprays": "the same damage progression based on distance from
// the origin" — a cone from the attacker's cell, the length long, opening
// the angle either side of the direction; the first ring is the critical
// zone, the last the graze, the rings between a hit. A cell on the cone's
// edge is in it.
export function getConeZones(origin: Coord, direction: number, length: number, angle: number): ZoneCell[] {
  const from = toPlane(origin)
  const heading = angleBetween(from, toPlane(add(origin, DIRECTIONS[direction])))
  const half = (angle / 2) * (Math.PI / 180) + 1e-9
  return disk(origin, length)
    .filter((cell) => !sameCell(cell, origin) && angularGap(heading, angleBetween(from, toPlane(cell))) <= half)
    .map((cell): ZoneCell => {
      const d = distance(origin, cell)
      return { cell, degree: d === 1 ? 'critical' : d === length ? 'graze' : 'hit' }
    })
}

// Every cell the explosion may reach as declared: the disk about its
// centre; for a spray, the cone once it is aimed and, until then, everything
// in its length of the attacker (combat.tex "Sprays": "target all
// characters in range"), less the attacker's own footprint.
export function getThreatenedCells(state: CombatState, action: ExplosionAction): Coord[] {
  const area = getExplosionArea(state, action)
  if (!area) return []
  if (area.shape === 'explosion') return action.center ? disk(action.center, area.radius) : []
  const from = state.board?.placements[action.actorId]
  const own = getPlacedFootprint(state, action.actorId) ?? []
  if (!from) return []
  const cells = action.direction === null
    ? disk(from.cell, area.length)
    : getConeZones(from.cell, action.direction, area.length, area.angle).map((z) => z.cell)
  return cells.filter((cell) => !own.some((o) => sameCell(o, cell)))
}

// The zones, once the explosion is fixed where it lands: a disk with a
// centre, a spray with a direction. Empty before.
export function getExplosionZones(state: CombatState, action: ExplosionAction): ZoneCell[] {
  const area = getExplosionArea(state, action)
  if (!area) return []
  if (area.shape === 'explosion') return action.center ? getDiskZones(action.center, area.radius) : []
  const from = state.board?.placements[action.actorId]
  const own = getPlacedFootprint(state, action.actorId) ?? []
  if (!from || action.direction === null) return []
  return getConeZones(from.cell, action.direction, area.length, area.angle).filter((z) => !own.some((o) => sameCell(o, z.cell)))
}

// combat.tex "Explosions": "If a creature occupies multiple spaces, apply
// the strongest effect." The degree the character's footprint takes where
// it stands now, or null outside the area.
export function getZoneOf(state: CombatState, action: ExplosionAction, id: string): Degree | null {
  const footprint = getPlacedFootprint(state, id)
  if (!footprint) return null
  const zones = new Map(getExplosionZones(state, action).map((z) => [coordKey(z.cell), z.degree]))
  return footprint.reduce<Degree | null>((best, cell) => {
    const here = zones.get(coordKey(cell)) ?? null
    return here !== null && (best === null || DEGREES.indexOf(here) > DEGREES.indexOf(best)) ? here : best
  }, null)
}

// Everyone the explosion may reach as declared, the attacker included when
// they stand in it: whoever's footprint touches a threatened cell.
export function getThreatenedIds(state: CombatState, action: ExplosionAction): string[] {
  const threatened = new Set(getThreatenedCells(state, action).map(coordKey))
  return Object.keys(state.characters).filter((id) => (getPlacedFootprint(state, id) ?? []).some((cell) => threatened.has(coordKey(cell))))
}

// Everyone the explosion reaches, with the zone each is in, as the board
// stands.
export function getAffected(state: CombatState, action: ExplosionAction): { id: string; degree: Degree }[] {
  return Object.keys(state.characters).flatMap((id) => {
    const degree = getZoneOf(state, action, id)
    return degree ? [{ id, degree }] : []
  })
}

// combat.tex "Explosions": "If the explosion comes from a projectile, the DL
// of the explosion is equal to the shooting skill."
export function getExplosionDLTerms(state: CombatState, action: ExplosionAction): Term[] {
  const attacker = state.characters[action.actorId]
  return attacker ? [{ label: 'accuracy', value: getAccuracy(attacker) }] : []
}

// Where a disk explosion may be aimed: any cell within the row's reach of
// the attacker's footprint that some cell of it sees (combat.tex "Cover"),
// off blocking ground. Nowhere for a spray, which is aimed by direction.
export function getExplosionCenters(state: CombatState, action: ExplosionAction): Coord[] {
  const board = state.board
  const from = board?.placements[action.actorId]
  const footprint = getPlacedFootprint(state, action.actorId)
  const reach = getShotReachOf(state, action)
  if (!board || !from || !footprint || reach === null || getExplosionArea(state, action)?.shape !== 'explosion') return []
  return disk(from.cell, reach).filter((cell) =>
    setDistance([cell], footprint) <= reach
    && !board.terrain[coordKey(cell)]?.blocking
    && seesAcross(board, footprint, [cell]))
}

// Whether the explosion as declared is aimed: a disk at a centre it may be
// aimed at, a spray at nothing yet.
export function isAimed(state: CombatState, action: ExplosionAction): boolean {
  const area = getExplosionArea(state, action)
  if (!area) return false
  if (area.shape === 'spray') return true
  return action.center !== null && getExplosionCenters(state, action).some((c) => sameCell(c, action.center!))
}
