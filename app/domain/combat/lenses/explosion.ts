import type { Area, CampaignCharacter, Delivery, SpellEffect, TerrainPatch } from '../../types'
import { DEGREES, type CombatState, type Coord, type Degree, type ExplosionAction, type ExplosionFacts } from '../types'
import { getRM } from '../../character/lenses/helpers'
import { produceSpellEffect } from '../../character/lenses/production'
import { getAccuracy } from '../../character/lenses/skills'
import { resolveDL } from '../../character/lenses/spells'
import { Term } from '../../character/lenses/terms'
import { getWieldedWeapons } from '../../item/lenses/hands'
import { SPELLS, isSpellKey } from '../../spells'
import { hasProperty } from '../../weaponProperties'
import { DIRECTIONS, add, coordKey, disk, distance, ring, sameCell, setDistance } from '../geometry'
import { angleBetween, angularGap, getPlacedFootprint, getShotReachOf, seesAcross, toPlane } from './board'

// combat.tex "Explosions", "Sprays": what goes off, where it reaches and how
// hard it hits there. The payload is read off the source the action names
// — the charge in a thrown item, a mundane explosive's own, a spell — and
// each of its effects covers its own area; the zones off where it is aimed;
// who is in which zone off the board as it stands, so the same lenses
// answer before the reactions move and after.

export type ZoneCell = { cell: Coord; degree: Degree }

// What the explosion is made of: the area effects of the charge a thrown
// item carries (spells.tex "Charged"), of the row itself for a mundane
// explosive (gear.tex "Explosion"), or of the spell for a cast or a charge
// set off; and who made them, whose size scales them. Empty while the
// source is not declared or has nothing to go off with.
export function getExplosionPayload(state: CombatState, action: ExplosionAction): { effects: SpellEffect[]; producer: CampaignCharacter } | null {
  const producer = state.characters[action.actorId]
  if (!producer) return null
  const areaEffects = (effects: SpellEffect[]) => effects.filter((e) => e.target === 'area' && e.area !== null)
  if (action.source === 'thrown') {
    const wielded = getWieldedWeapons(producer).find((w) => w.key === action.weaponKey)
    const atk = wielded?.weapon.attacks.find((a) => a.name === action.attack)
    if (!wielded || !atk || !hasProperty(atk.properties, 'explosion')) return null
    const item = producer.held.find((i) => i.id === wielded.itemId)
    const charge = item?.charge && isSpellKey(item.charge) ? SPELLS[item.charge].effects : null
    const effects = areaEffects(charge ?? atk.payload)
    return effects.length > 0 ? { effects, producer } : null
  }
  const effects = isSpellKey(action.key) ? areaEffects(SPELLS[action.key].effects) : []
  return effects.length > 0 ? { effects, producer } : null
}

// Whether a thrown row has anything to go off with: a charge in the item,
// or a mundane explosive's own payload.
export function hasExplosionPayload(c: CampaignCharacter, weaponKey: string, attack: string): boolean {
  const wielded = getWieldedWeapons(c).find((w) => w.key === weaponKey)
  const atk = wielded?.weapon.attacks.find((a) => a.name === attack)
  if (!wielded || !atk) return false
  const item = c.held.find((i) => i.id === wielded.itemId)
  return (item?.charge !== null && item?.charge !== undefined && isSpellKey(item.charge)) || atk.payload.some((e) => e.target === 'area' && e.area !== null)
}

// creating.tex "Reach Multiplier": "xRM" — an area at the producer's size.
function scaled(area: Area, RM: number): Area {
  return area.shape === 'explosion'
    ? { shape: 'explosion', radius: Math.floor(area.radius * RM) }
    : { shape: 'spray', length: Math.floor(area.length * RM), angle: area.angle }
}

// The areas the payload covers, one per effect that has one, in cells.
export function getExplosionAreas(state: CombatState, action: ExplosionAction): Area[] {
  const payload = getExplosionPayload(state, action)
  if (!payload) return []
  const RM = getRM(payload.producer)
  return payload.effects.flatMap((e) => (e.area ? [scaled(e.area, RM)] : []))
}

// Whether any of it is a spray, which is aimed by direction once the
// reactions have moved (combat.tex "Sprays").
export function isSpray(state: CombatState, action: ExplosionAction): boolean {
  return getExplosionAreas(state, action).some((a) => a.shape === 'spray')
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

// The zones of one area, once the explosion is fixed where it lands: a disk
// at the centre, a spray in its direction from the attacker, less the
// attacker's own footprint. Empty before.
export function getAreaZones(state: CombatState, action: ExplosionAction, area: Area): ZoneCell[] {
  if (area.shape === 'explosion') return action.center ? getDiskZones(action.center, area.radius) : []
  const from = state.board?.placements[action.actorId]
  const own = getPlacedFootprint(state, action.actorId) ?? []
  if (!from || action.direction === null) return []
  return getConeZones(from.cell, action.direction, area.length, area.angle).filter((z) => !own.some((o) => sameCell(o, z.cell)))
}

// Every cell the explosion may reach as declared: the disks about its
// centre; for a spray, the cone once it is aimed and, until then, everything
// in its length of the attacker (combat.tex "Sprays": "target all
// characters in range"), less the attacker's own footprint.
export function getThreatenedCells(state: CombatState, action: ExplosionAction): Coord[] {
  const from = state.board?.placements[action.actorId]
  const own = getPlacedFootprint(state, action.actorId) ?? []
  const cells = new Map<string, Coord>()
  for (const area of getExplosionAreas(state, action)) {
    const reach = area.shape === 'explosion'
      ? (action.center ? disk(action.center, area.radius) : [])
      : !from ? [] : action.direction === null ? disk(from.cell, area.length).filter((c) => !own.some((o) => sameCell(o, c))) : getAreaZones(state, action, area).map((z) => z.cell)
    for (const cell of reach) cells.set(coordKey(cell), cell)
  }
  return [...cells.values()]
}

const worse = (a: Degree | null, b: Degree): Degree => (a === null || DEGREES.indexOf(b) > DEGREES.indexOf(a) ? b : a)

// The zones of the whole explosion, each cell at the worst of what reaches
// it. Empty until it is fixed where it lands.
export function getExplosionZones(state: CombatState, action: ExplosionAction): ZoneCell[] {
  const zones = new Map<string, ZoneCell>()
  for (const area of getExplosionAreas(state, action)) {
    for (const z of getAreaZones(state, action, area)) {
      const key = coordKey(z.cell)
      zones.set(key, { cell: z.cell, degree: worse(zones.get(key)?.degree ?? null, z.degree) })
    }
  }
  return [...zones.values()]
}

// combat.tex "Explosions": "If a creature occupies multiple spaces, apply
// the strongest effect." The degree the character's footprint takes from
// one area where it stands now, or null outside it.
export function getZoneOf(state: CombatState, action: ExplosionAction, id: string, area: Area): Degree | null {
  const footprint = getPlacedFootprint(state, id)
  if (!footprint) return null
  const zones = new Map(getAreaZones(state, action, area).map((z) => [coordKey(z.cell), z.degree]))
  return footprint.reduce<Degree | null>((best, cell) => {
    const here = zones.get(coordKey(cell)) ?? null
    return here !== null ? worse(best, here) : best
  }, null)
}

// Everyone the explosion may reach as declared, the attacker included when
// they stand in it: whoever's footprint touches a threatened cell.
export function getThreatenedIds(state: CombatState, action: ExplosionAction): string[] {
  const threatened = new Set(getThreatenedCells(state, action).map(coordKey))
  return Object.keys(state.characters).filter((id) => (getPlacedFootprint(state, id) ?? []).some((cell) => threatened.has(coordKey(cell))))
}

// Everyone the explosion reaches, with the worst zone each is in, as the
// board stands.
export function getAffected(state: CombatState, action: ExplosionAction): { id: string; degree: Degree }[] {
  return Object.keys(state.characters).flatMap((id) => {
    const degree = getExplosionAreas(state, action).reduce<Degree | null>((best, area) => {
      const here = getZoneOf(state, action, id, area)
      return here !== null ? worse(best, here) : best
    }, null)
    return degree ? [{ id, degree }] : []
  })
}

// What reaches each character in the area: every effect of the payload
// whose area they stand in, at that zone's degree, made by the producer
// (spells.tex "Casting spells"; gear.tex "Explosion": "applies the weapon's
// damage ... and any other effects"). What goes to the ground is not here.
export function getExplosionFacts(state: CombatState, action: ExplosionAction): ExplosionFacts {
  const payload = getExplosionPayload(state, action)
  if (!payload) return {}
  const RM = getRM(payload.producer)
  const facts: ExplosionFacts = {}
  for (const id of Object.keys(state.characters)) {
    const deliveries = payload.effects.flatMap((e): Delivery[] => {
      if (!e.area || e.type === 'terrain') return []
      const degree = getZoneOf(state, action, id, scaled(e.area, RM))
      return degree ? [{ ...produceSpellEffect(payload.producer, e), degree, test: null }] : []
    })
    if (deliveries.length > 0) facts[id] = deliveries
  }
  return facts
}

// combat.tex "Gas": what the explosion leaves on the ground, cell by cell —
// each terrain effect's patch for the zone the cell is in.
export function getTerrainPaint(state: CombatState, action: ExplosionAction): { cell: Coord; patch: TerrainPatch }[] {
  const payload = getExplosionPayload(state, action)
  if (!payload) return []
  const RM = getRM(payload.producer)
  return payload.effects.flatMap((e) => {
    if (e.type !== 'terrain' || !e.area) return []
    return getAreaZones(state, action, scaled(e.area, RM)).flatMap((z) => (z.degree === 'miss' ? [] : [{ cell: z.cell, patch: e.effect[z.degree] }]))
  })
}

// combat.tex "Explosions": "If the explosion comes from a projectile, the DL
// of the explosion is equal to the shooting skill." A cast's is what its
// effects say the target rolls against (the worst of them); a charge set
// off from hiding leaves no test at all.
export function getExplosionDLTerms(state: CombatState, action: ExplosionAction): Term[] {
  const payload = getExplosionPayload(state, action)
  if (!payload) return []
  if (action.source === 'thrown') return [{ label: 'accuracy', value: getAccuracy(payload.producer) }]
  if (action.source === 'detonate') return []
  const DLs = payload.effects.flatMap((e) => (e.resist ? [resolveDL(payload.producer, e.resist.dl, e.resist.roll).value ?? 0] : []))
  return DLs.length > 0 ? [{ label: 'spell', value: Math.max(...DLs) }] : []
}

// Whether anyone can react to it: a thrown or cast explosion is defended
// with a reflex test (combat.tex "Explosions"); one set off from hiding is
// not — "If the explosion occurs before being perceived, no test can be
// made."
export function isAvoidable(action: ExplosionAction): boolean {
  return action.source !== 'detonate'
}

// Where a disk explosion may be aimed. Thrown: any cell within the row's
// reach of the attacker's footprint that some cell of it sees (combat.tex
// "Cover"), off blocking ground. Cast: within the effects' range of the
// caster, in sight. Set off: anywhere on the ground. Nowhere for a spray,
// which is aimed by direction.
export function getExplosionCenters(state: CombatState, action: ExplosionAction): Coord[] {
  const board = state.board
  const from = board?.placements[action.actorId]
  const footprint = getPlacedFootprint(state, action.actorId)
  const payload = getExplosionPayload(state, action)
  if (!board || !from || !footprint || !payload || isSpray(state, action) || getExplosionAreas(state, action).length === 0) return []
  const open = (cell: Coord) => !board.terrain[coordKey(cell)]?.blocking
  if (action.source === 'detonate') return disk(board.origin, board.radius).filter(open)
  const reach = action.source === 'thrown'
    ? getShotReachOf(state, action)
    : Math.min(...payload.effects.map((e) => e.range ?? 1))
  if (reach === null) return []
  return disk(from.cell, reach).filter((cell) => setDistance([cell], footprint) <= reach && open(cell) && seesAcross(board, footprint, [cell]))
}

// Whether the explosion as declared is aimed: a disk at a centre it may be
// aimed at, a spray at nothing yet.
export function isAimed(state: CombatState, action: ExplosionAction): boolean {
  if (getExplosionAreas(state, action).length === 0) return false
  if (isSpray(state, action)) return true
  return action.center !== null && getExplosionCenters(state, action).some((c) => sameCell(c, action.center!))
}
