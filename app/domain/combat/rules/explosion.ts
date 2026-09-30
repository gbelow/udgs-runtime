import type { Area, CampaignCharacter, Delivery, Item, SpellEffect } from '../../types'
import { DEGREES, type BlastAction, type CombatState, type Coord, type Degree, type Deliveries, type ExplosionAction, type Hazard } from '../types'
import { getUndefendedDamage } from '../../character/rules/damage'
import { produceEffects, produceSpellEffect } from '../../character/rules/production'
import { getAccuracy } from '../../character/rules/skills'
import { getCastSize, resolveDL } from '../../character/rules/spells'
import { Term } from '../../character/rules/terms'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { hasProperty } from '../../weaponProperties'
import { DIRECTIONS, add, angleBetween, angularGap, coordKey, disk, distance, ring, sameCell, setDistance, toPlane } from '../geometry'
import { getPlacedFootprint, getShotReachOf, seesAcross } from './board'
import { findWeaponRow, type WeaponRow } from './weaponRow'
import { getHeldItem } from '../../item/rules/hands'
import { findHeldItem } from './fighters'
import { findFloorItem } from './floor'
import { getAction } from './log'

// combat.tex "Explosions", "Sprays": what goes off, where it reaches and how
// hard it hits there. The payload is read off the source the action names
// — the charge in a thrown item, a mundane explosive's own, a spell — and
// each of its effects covers its own area; the zones off where it is aimed;
// who is in which zone off the board as it stands, so the same rules
// answer before the reactions move and after.

export type ZoneCell = { cell: Coord; degree: Degree }

// An area laid out on the board: who set it off, where it was aimed, and
// the effects that cover it — an explosion as declared, before it goes off,
// or the blast it goes off as. A spray is pointed only on the blast.
export type BlastShape = Pick<BlastAction, 'actorId' | 'center' | 'direction' | 'effects'>

export function getBlastOf(state: CombatState, action: ExplosionAction): BlastShape {
  return toBlast(action, getExplosionPayload(state, action))
}

function toBlast(action: ExplosionAction, payload: Payload | null): BlastShape {
  return { actorId: action.actorId, center: action.center, direction: null, effects: payload?.effects ?? [] }
}

type Payload = { effects: SpellEffect[]; producer: CampaignCharacter }

// What the explosion is made of: the area effects of the charge a thrown
// item carries (spells.tex "Charged"), of the row itself for a mundane
// explosive (gear.tex "Explosion"), or of the spell for a cast or a charge
// set off; and who made them, whose size scales them. Empty while the
// source is not declared or has nothing to go off with.
export function getExplosionPayload(state: CombatState, action: ExplosionAction): Payload | null {
  const producer = state.characters[action.actorId]
  if (!producer) return null
  const effects = (() => {
    if (action.source === 'thrown') {
      const row = findWeaponRow(producer, action.weaponKey, action.attack)
      return row && hasProperty(row.atk.properties, 'explosion') ? getRowAreaEffects(producer, row) : []
    }
    if (action.source === 'detonate') {
      const charge = findHeldItem(state, action.itemId)?.item.charge ?? findFloorItem(state, action.itemId)?.item.charge
      return charge?.effects.filter(isAreaEffect) ?? []
    }
    if (!isSpellKey(action.key)) return []
    // spells.tex "Amplify Spell": at the size the cast that opened it was made at
    const cast = action.spawnedBy ? getAction(state, action.spawnedBy) : null
    const size = getCastSize(producer, action.key, cast?.kind === 'cast' ? cast.improved.amplify ?? 0 : 0)
    return produceEffects(producer, SPELLS[action.key].effects, size).filter(isAreaEffect)
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
// with an area to it, in the hands of someone standing on the board, or
// lying on the floor — `holderId` null for the latter. The table sets off
// any of them; a detonation a cast opened (spells.tex "Detonate
// Explosive") reaches only those within the spell's range of the caster,
// as far as the cast was extended ("Extend Spell").
export type ChargeOption = { itemId: string; key: SpellKey; holderId: string | null; cell: Coord }

function hasChargedArea(item: Item): item is Item & { charge: NonNullable<Item['charge']> & { key: SpellKey } } {
  const key = item.charge?.key
  return !!key && isSpellKey(key) && (item.charge?.effects.some(isAreaEffect) ?? false)
}

export function getChargeOptions(state: CombatState, action?: ExplosionAction): ChargeOption[] {
  const range = action ? getDetonationRange(state, action) : null
  const footprint = action ? getPlacedFootprint(state, action.actorId) : null
  const all = getAllCharges(state)
  return range === null ? all : all.filter((o) => footprint !== null && setDistance([o.cell], footprint) <= range)
}

// The metres a detonation reaches from its caster: the spell's range, times
// the extensions the cast bought; null when nothing bounds it.
function getDetonationRange(state: CombatState, action: ExplosionAction): number | null {
  const cast = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  if (cast?.kind !== 'cast' || !isSpellKey(cast.key)) return null
  const detonate = SPELLS[cast.key].detonate
  return detonate ? detonate.range * (1 + cast.extend) : null
}

function getAllCharges(state: CombatState): ChargeOption[] {
  const held = Object.values(state.characters).flatMap((holder) => {
    const cell = state.board?.placements[holder.id]?.cell
    if (!cell) return []
    return holder.held.flatMap((item): ChargeOption[] => (hasChargedArea(item) ? [{ itemId: item.id, key: item.charge.key, holderId: holder.id, cell }] : []))
  })
  const onFloor = state.floor.flatMap((f): ChargeOption[] => (f.cell && hasChargedArea(f.item) ? [{ itemId: f.item.id, key: f.item.charge.key, holderId: null, cell: f.cell }] : []))
  return [...held, ...onFloor]
}

// Whether a thrown row has anything with an area to go off with.
export function hasExplosionPayload(c: CampaignCharacter, weaponKey: string, attack: string): boolean {
  const row = findWeaponRow(c, weaponKey, attack)
  return row !== null && getRowAreaEffects(c, row).length > 0
}

// The areas the effects cover, one per effect that has one, in cells —
// already at the size of whoever produced them.
export function getExplosionAreas(blast: BlastShape): Area[] {
  return blast.effects.flatMap((e) => (e.area ? [e.area] : []))
}

// Whether any of it is a spray, which is aimed by direction once the
// reactions have moved (combat.tex "Sprays").
export function isSpray(blast: BlastShape): boolean {
  return getExplosionAreas(blast).some((a) => a.shape === 'spray')
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
function getAreaZones(state: CombatState, action: BlastShape, area: Area): ZoneCell[] {
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
export function getThreatenedCells(state: CombatState, action: BlastShape): Coord[] {
  const from = state.board?.placements[action.actorId]
  const own = getPlacedFootprint(state, action.actorId) ?? []
  const cells = new Map<string, Coord>()
  for (const area of getExplosionAreas(action)) {
    const reach = area.shape === 'explosion'
      ? (action.center ? disk(action.center, area.radius) : [])
      : !from ? [] : action.direction === null ? disk(from.cell, area.length).filter((c) => !own.some((o) => sameCell(o, c))) : getAreaZones(state, action, area).map((z) => z.cell)
    for (const cell of reach) cells.set(coordKey(cell), cell)
  }
  return [...cells.values()]
}

// The worst of the degrees that reach, or null when none does.
function worstOf(degrees: (Degree | null)[]): Degree | null {
  return degrees.reduce<Degree | null>((worst, d) => (d !== null && (worst === null || DEGREES.indexOf(d) > DEGREES.indexOf(worst)) ? d : worst), null)
}

// The zones of the whole explosion, each cell at the worst of what reaches
// it. Empty until it is fixed where it lands.
export function getExplosionZones(state: CombatState, action: BlastShape): ZoneCell[] {
  const zones = new Map<string, ZoneCell>()
  for (const area of getExplosionAreas(action)) {
    for (const z of getAreaZones(state, action, area)) {
      const key = coordKey(z.cell)
      zones.set(key, { cell: z.cell, degree: worstOf([zones.get(key)?.degree ?? null, z.degree]) ?? z.degree })
    }
  }
  return [...zones.values()]
}

// combat.tex "Explosions": "If a creature occupies multiple spaces, apply
// the strongest effect." The degree the character's footprint takes from
// one area where it stands now, or null outside it.
function getZoneOf(state: CombatState, action: BlastShape, id: string, area: Area): Degree | null {
  const footprint = getPlacedFootprint(state, id)
  if (!footprint) return null
  const zones = new Map(getAreaZones(state, action, area).map((z) => [coordKey(z.cell), z.degree]))
  return worstOf(footprint.map((cell) => zones.get(coordKey(cell)) ?? null))
}

// Everyone the explosion may reach as declared, the attacker included when
// they stand in it: whoever's footprint touches a threatened cell.
export function getThreatenedIds(state: CombatState, action: BlastShape): string[] {
  const threatened = new Set(getThreatenedCells(state, action).map(coordKey))
  return Object.keys(state.characters).filter((id) => (getPlacedFootprint(state, id) ?? []).some((cell) => threatened.has(coordKey(cell))))
}

// Everyone the explosion reaches, with the worst zone each is in, as the
// board stands.
export function getAffected(state: CombatState, action: BlastShape): { id: string; degree: Degree }[] {
  return Object.keys(state.characters).flatMap((id) => {
    const degree = worstOf(getExplosionAreas(action).map((area) => getZoneOf(state, action, id, area)))
    return degree ? [{ id, degree }] : []
  })
}

// What reaches each character in the area: every effect whose area they
// stand in, at that zone's degree, made by whoever set it off (spells.tex
// "Casting spells"; gear.tex "Explosion": "applies the weapon's damage ...
// and any other effects"). What goes to the ground is not here.
export function getExplosionFacts(state: CombatState, action: BlastShape): Deliveries {
  const producer = state.characters[action.actorId]
  if (!producer) return {}
  const facts: Deliveries = {}
  for (const id of Object.keys(state.characters)) {
    const deliveries = action.effects.flatMap((e): Delivery[] => {
      if (!e.area || e.type === 'terrain') return []
      const degree = getZoneOf(state, action, id, e.area)
      return degree ? [{ ...produceSpellEffect(producer, e), degree, test: null }] : []
    })
    if (deliveries.length > 0) facts[id] = deliveries
  }
  return facts
}

// combat.tex "Gas", "Fire": what the explosion leaves on the ground, cell
// by cell — each terrain effect's patch for the zone the cell is in. A patch
// that ignites leaves a surface burning with what the explosion's own burn
// deals there (spells.tex "Flamethrower": the surface deals the same damage
// as the initial hit, the table's ruling).
export function getTerrainPaint(state: CombatState, action: BlastShape): { cell: Coord; hazard: Hazard }[] {
  const burns = getBurns(state, action)
  return action.effects.flatMap((e) => {
    if (e.type !== 'terrain' || !e.area) return []
    return getAreaZones(state, action, e.area).flatMap((z) => {
      if (z.degree === 'miss') return []
      const patch = e.effect[z.degree]
      return [{ cell: z.cell, hazard: { fire: patch.ignite ? burns.get(coordKey(z.cell)) ?? 0 : 0, suffocating: patch.suffocating, visibility: patch.visibility } }]
    })
  })
}

// The burn the explosion's damage effects deal on each cell, each at the
// zone the cell is in for its own area.
function getBurns(state: CombatState, action: BlastShape): Map<string, number> {
  const burns = new Map<string, number>()
  for (const e of action.effects) {
    if (e.type !== 'damage' || !e.area) continue
    const burn = e.effect.damage.filter((d) => d.kind === 'burn').reduce((total, d) => total + d.value, 0)
    for (const z of getAreaZones(state, action, e.area)) {
      const key = coordKey(z.cell)
      burns.set(key, (burns.get(key) ?? 0) + getUndefendedDamage(burn, z.degree))
    }
  }
  return burns
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
// caster, in sight — the explosion is the spell's effect, which Extend
// does not reach. Set off: where the charged object is — whoever holds
// it stands, or the cell it lies on if it is on the floor. Nowhere for a
// spray, which is aimed by direction.
export function getExplosionCenters(state: CombatState, action: ExplosionAction): Coord[] {
  return getCentersOf(state, action, getExplosionPayload(state, action))
}

function getCentersOf(state: CombatState, action: ExplosionAction, payload: Payload | null): Coord[] {
  const board = state.board
  const from = board?.placements[action.actorId]
  const footprint = getPlacedFootprint(state, action.actorId)
  if (!board || !from || !footprint || !payload || isSpray(toBlast(action, payload))) return []
  const open = (cell: Coord) => !board.terrain[coordKey(cell)]?.blocking
  if (action.source === 'detonate') {
    const held = findHeldItem(state, action.itemId)
    if (held) return getPlacedFootprint(state, held.holder.id) ?? []
    const floored = findFloorItem(state, action.itemId)
    return floored?.cell ? [floored.cell] : []
  }
  const reach = action.source === 'thrown'
    ? getShotReachOf(state, action)
    : Math.min(...payload.effects.map((e) => e.range ?? 1))
  if (reach === null) return []
  return disk(from.cell, reach).filter((cell) => setDistance([cell], footprint) <= reach && open(cell) && seesAcross(board, footprint, [cell]))
}

// Whether the area is still its actor's to point, and can be pointed
// somewhere else: a disk until they commit to the explosion, a spray until
// the blast is confirmed (combat.tex "Sprays": "The attacker can choose the
// exact direction of the cone after the movement").
export function isAimable(state: CombatState, action: ExplosionAction | BlastAction): boolean {
  if (action.kind === 'blast') return action.step === 'post' && isSpray(action)
  const blast = getBlastOf(state, action)
  return getExplosionAreas(blast).length > 0 && action.step === 'define' && !isSpray(blast)
}

// Whether the explosion as declared is aimed: a disk at a centre it may be
// aimed at, a spray at nothing yet.
export function isAimed(state: CombatState, action: ExplosionAction): boolean {
  const payload = getExplosionPayload(state, action)
  if (!payload) return false
  if (isSpray(toBlast(action, payload))) return true
  return action.center !== null && getCentersOf(state, action, payload).some((c) => sameCell(c, action.center!))
}
