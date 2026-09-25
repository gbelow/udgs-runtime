import type { Area, CampaignCharacter, Delivery, SpellEffect, TerrainPatch } from '../../types'
import { DEGREES, type CombatState, type Coord, type Degree, type Deliveries, type ExplosionAction } from '../types'
import { produceEffects, produceSpellEffect } from '../../character/rules/production'
import { getAccuracy } from '../../character/rules/skills'
import { resolveDL } from '../../character/rules/spells'
import { Term } from '../../character/rules/terms'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { hasProperty } from '../../weaponProperties'
import { DIRECTIONS, add, coordKey, disk, distance, ring, sameCell, setDistance } from '../geometry'
import { angleBetween, angularGap, getPlacedFootprint, getShotReachOf, seesAcross, toPlane } from './board'
import { findWeaponRow, type WeaponRow } from './weaponRow'
import { getHeldItem } from '../../item/rules/hands'
import { findHeldItem, getFightName } from './activeCharacter'

// combat.tex "Explosions", "Sprays": what goes off, where it reaches and how
// hard it hits there. The payload is read off the source the action names
// — the charge in a thrown item, a mundane explosive's own, a spell — and
// each of its effects covers its own area; the zones off where it is aimed;
// who is in which zone off the board as it stands, so the same rules
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
  const effects = (() => {
    if (action.source === 'thrown') {
      const row = findWeaponRow(producer, action.weaponKey, action.attack)
      return row && hasProperty(row.atk.properties, 'explosion') ? getRowAreaEffects(producer, row) : []
    }
    if (action.source === 'detonate') return findHeldItem(state, action.itemId)?.item.charge?.effects.filter(isAreaEffect) ?? []
    return isSpellKey(action.key) ? produceEffects(producer, SPELLS[action.key].effects).filter(isAreaEffect) : []
  })()
  return effects.length > 0 ? { effects, producer } : null
}

// An effect that covers an area rather than one character (combat.tex
// "Explosions").
export function isAreaEffect(e: SpellEffect): boolean {
  return e.target === 'area' && e.area !== null
}

// What a thrown row goes off with: the charge its item carries, or a
// mundane explosive's own payload.
function getRowAreaEffects(producer: CampaignCharacter, row: WeaponRow): SpellEffect[] {
  const charge = getHeldItem(producer, row.wielded.itemId)?.charge
  return (charge ? charge.effects : produceEffects(producer, row.atk.payload)).filter(isAreaEffect)
}

// Every charge in the fight that can be set off from where it lies: one
// with an area to it, in the hands of someone standing on the board.
export type ChargeOption = { itemId: string; key: SpellKey; name: string; item: string; holder: string; cell: Coord }

export function getChargeOptions(state: CombatState): ChargeOption[] {
  return Object.values(state.characters).flatMap((holder) => {
    const cell = state.board?.placements[holder.id]?.cell
    if (!cell) return []
    return holder.held.flatMap((item): ChargeOption[] => {
      const key = item.charge?.key
      if (!key || !isSpellKey(key) || !item.charge?.effects.some(isAreaEffect)) return []
      return [{ itemId: item.id, key, name: SPELLS[key].name, item: item.name, holder: getFightName(state, holder.id), cell }]
    })
  })
}

// Whether a thrown row has anything with an area to go off with.
export function hasExplosionPayload(c: CampaignCharacter, weaponKey: string, attack: string): boolean {
  const row = findWeaponRow(c, weaponKey, attack)
  return row !== null && getRowAreaEffects(c, row).length > 0
}

// The areas the payload covers, one per effect that has one, in cells —
// already at the size of whoever produced it.
export function getExplosionAreas(state: CombatState, action: ExplosionAction): Area[] {
  const payload = getExplosionPayload(state, action)
  return payload ? payload.effects.flatMap((e) => (e.area ? [e.area] : [])) : []
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
function getDiskZones(center: Coord, radius: number): ZoneCell[] {
  return Array.from({ length: radius + 1 }, (_, k) =>
    ring(center, k).map((cell): ZoneCell => ({ cell, degree: k === 0 ? 'critical' : k === radius ? 'graze' : 'hit' })),
  ).flat()
}

// combat.tex "Sprays": "the same damage progression based on distance from
// the origin" — a cone from the attacker's cell, the length long, opening
// the angle either side of the direction; the first ring is the critical
// zone, the last the graze, the rings between a hit. A cell on the cone's
// edge is in it.
function getConeZones(origin: Coord, direction: number, length: number, angle: number): ZoneCell[] {
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
function getAreaZones(state: CombatState, action: ExplosionAction, area: Area): ZoneCell[] {
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
function getZoneOf(state: CombatState, action: ExplosionAction, id: string, area: Area): Degree | null {
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
export function getExplosionFacts(state: CombatState, action: ExplosionAction): Deliveries {
  const payload = getExplosionPayload(state, action)
  if (!payload) return {}
  const facts: Deliveries = {}
  for (const id of Object.keys(state.characters)) {
    const deliveries = payload.effects.flatMap((e): Delivery[] => {
      if (!e.area || e.type === 'terrain') return []
      const degree = getZoneOf(state, action, id, e.area)
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
  return payload.effects.flatMap((e) => {
    if (e.type !== 'terrain' || !e.area) return []
    return getAreaZones(state, action, e.area).flatMap((z) => (z.degree === 'miss' ? [] : [{ cell: z.cell, patch: e.effect[z.degree] }]))
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
// caster, in sight. Set off: where the charged object is, which is where
// whoever holds it stands. Nowhere for a spray, which is aimed by
// direction.
export function getExplosionCenters(state: CombatState, action: ExplosionAction): Coord[] {
  const board = state.board
  const from = board?.placements[action.actorId]
  const footprint = getPlacedFootprint(state, action.actorId)
  const payload = getExplosionPayload(state, action)
  if (!board || !from || !footprint || !payload || isSpray(state, action) || getExplosionAreas(state, action).length === 0) return []
  const open = (cell: Coord) => !board.terrain[coordKey(cell)]?.blocking
  if (action.source === 'detonate') {
    const held = findHeldItem(state, action.itemId)
    return held ? (getPlacedFootprint(state, held.holder.id) ?? []) : []
  }
  const reach = action.source === 'thrown'
    ? getShotReachOf(state, action)
    : Math.min(...payload.effects.map((e) => e.range ?? 1))
  if (reach === null) return []
  return disk(from.cell, reach).filter((cell) => setDistance([cell], footprint) <= reach && open(cell) && seesAcross(board, footprint, [cell]))
}

// Whether the explosion is still its actor's to point, and can be pointed
// somewhere else: a disk until they commit to it, a spray until the blast
// is confirmed (combat.tex "Sprays": "The attacker can choose the exact
// direction of the cone after the movement").
export function isAimable(state: CombatState, action: ExplosionAction): boolean {
  if (getExplosionAreas(state, action).length === 0) return false
  return action.status === 'declared' || (action.status === 'rolled' && isSpray(state, action))
}

// Whether the explosion as declared is aimed: a disk at a centre it may be
// aimed at, a spray at nothing yet.
export function isAimed(state: CombatState, action: ExplosionAction): boolean {
  if (getExplosionAreas(state, action).length === 0) return false
  if (isSpray(state, action)) return true
  return action.center !== null && getExplosionCenters(state, action).some((c) => sameCell(c, action.center!))
}
