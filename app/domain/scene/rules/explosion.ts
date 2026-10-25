import type { Area, CampaignCharacter, Damage, Delivery, Item, SpellEffect } from '../../types'
import { DEGREES, type BlastAction, type SceneState, type Coord, type Degree, type Deliveries, type ExplosionAction, type Hazard, type ThrowAction } from '../types'
import { makeAction } from '../factories'
import { getUndefendedDamage } from '../../character/rules/damage'
import { getSpellEffects, produceEffects, produceSpellEffect, produceUnownedEffect } from '../../character/rules/production'
import { getAccuracy } from '../../character/rules/skills'
import { getCastSize, hasChargeTrigger, resolveDL } from '../../character/rules/spells'
import { Term } from '../../character/rules/terms'
import { SPELLS, isSpellKey, type SpellKey } from '../../spells'
import { explodes } from '../../weaponProperties'
import { DIRECTIONS, add, angleBetween, angularGap, coordKey, disk, distance, ring, sameCell, setDistance, toPlane } from './board/geometry'
import { getAimableCells, getCover, getPlacedFootprint, seesAcross, toDamageWall } from './board/board'
import { getItemWeapon } from '../../item/rules/items'
import { getReadyItems } from '../../item/rules/containers'
import { findReadyObject } from './fighters'
import { findFloorItem } from './floor'
import { getAction, getReactionsTo } from './log'
import { getSensoryTerms, getSensoryTermsOfDL } from './detection'
import { findWeaponRow } from './weaponRow'
import type { Defense } from './delivery'
import { getBlockValue } from '../../character/rules/gear'

// combat.tex "Explosions", "Sprays": what goes off, where it reaches and how
// hard it hits there. The payload is read off the source the action names
// — the charge in an object, a mundane explosive's own, a spell — and
// each of its effects covers its own area; the zones off where it is aimed;
// who is in which zone off the board as it stands, so the same rules
// answer before the reactions move and after.

export type ZoneCell = { cell: Coord; degree: Degree }

// An area laid out on the board: who set it off, where it was aimed, and
// the effects that cover it — an explosion as declared, before it goes off,
// or the blast it goes off as. A spray is pointed only on the blast.
export type BlastShape = Pick<BlastAction, 'actorId' | 'center' | 'direction' | 'effects' | 'paintOnly' | 'armorRolls' | 'gm'>

export function getBlastOf(state: SceneState, action: ExplosionAction): BlastShape {
  return toBlast(action, getExplosionPayload(state, action))
}

function toBlast(action: ExplosionAction, payload: Payload | null): BlastShape {
  return { actorId: action.actorId, center: action.center, direction: null, effects: payload?.effects ?? [], paintOnly: action.paintOnly, armorRolls: action.armorRolls, gm: action.source === 'gm' }
}

type Payload = { effects: SpellEffect[]; producer: CampaignCharacter | null }

// spells.tex "Charged": the explosion a thrown item opens where it lands,
// as the fields given open it; null when it would not go off there.
export function getImpactExplosion(state: SceneState, actorId: string, item: Item, center: Coord, fields: Pick<ExplosionAction, 'id'> & Partial<ExplosionAction> = { id: '' }): ExplosionAction | null {
  if (!goesOffOnImpact(item)) return null
  const explosion = makeAction('explosion', { ...fields, actorId, source: 'thrown', itemId: item.id, center })
  return getExplosionPayload(state, explosion) ? explosion : null
}

// The explosion a throw as declared would open, laid out before the commit.
export function getImpactBlast(state: SceneState, action: ThrowAction): BlastShape | null {
  const item = findObject(state, action.itemId)
  const explosion = item && action.to ? getImpactExplosion(state, action.actorId, item, action.to) : null
  return explosion ? getBlastOf(state, explosion) : null
}

// What the explosion is made of: the area effects of the object it goes
// off in — its charge (spells.tex "Charged"), or a mundane explosive's own
// (gear.tex "Explosion") — or of the spell for a cast; and who made them,
// whose size scales them. Empty while there is nothing to go off with.
export function getExplosionPayload(state: SceneState, action: ExplosionAction): Payload | null {
  if (action.source === 'gm') return action.effects.length > 0 ? { effects: action.effects, producer: null } : null
  const producer = state.characters[action.actorId]
  if (!producer) return null
  const effects = (() => {
    if (action.source !== 'cast') {
      const item = findObject(state, action.itemId)
      return item ? getObjectEffects(producer, item).filter(isAreaEffect) : []
    }
    if (!isSpellKey(action.key)) return []
    // spells.tex "Amplify Spell": at the size the cast that opened it was
    // made at, or the one a held spell fired again was cast at
    const opener = action.spawnedBy ? getAction(state, action.spawnedBy) : null
    const cast = opener?.kind === 'cast' ? opener : null
    const again = opener?.kind === 'fireAgain' ? opener : null
    const itemId = again?.itemId ?? cast?.itemId
    const size = again?.size ?? getCastSize(producer, action.key, cast?.improved.amplify ?? 0, itemId)
    return produceEffects(producer, getSpellEffects(producer, action.key, itemId), size).filter(isAreaEffect)
  })()
  return effects.length > 0 ? { effects, producer } : null
}

// The object a charge is in, at someone's hand or lying on the floor.
export function findObject(state: SceneState, itemId: string): Item | null {
  return findReadyObject(state, itemId)?.item ?? findFloorItem(state, itemId)?.item ?? null
}

// What an object goes off with: its charge, or else what its exploding rows
// carry of their own.
function getObjectEffects(producer: CampaignCharacter, item: Item): SpellEffect[] {
  if (item.charge) return item.charge.effects
  const rows = getItemWeapon(item)?.attacks.filter(explodes) ?? []
  return rows.flatMap((a) => produceEffects(producer, a.payload))
}

// Whether the object goes off where it lands when thrown, if it has
// anything to go off with: a charge with the impact trigger, or a mundane
// explosive (gear.tex "Grenade": "ignited by a mundane fuse or impact").
function goesOffOnImpact(item: Item): boolean {
  return !item.charge || hasChargeTrigger(item.charge, 'impact')
}

// An effect that covers an area rather than one character (combat.tex
// "Explosions").
export function isAreaEffect(e: SpellEffect): boolean {
  return e.target === 'area' && e.area !== null
}

// Every charge in the fight a detonation can set off from where it lies:
// one with an area to it, whatever its triggers, in the hands of someone
// standing on the board or the detonator's own quick slots, or lying on the
// floor — `holderId` null for the latter. What others carry in their slots
// is not known to the detonator. A detonation a cast opened (spells.tex "Detonate Explosive")
// reaches only those within the spell's range of the caster, as far as the
// cast was extended ("Extend Spell").
export type ChargeOption = { itemId: string; key: SpellKey; holderId: string | null; cell: Coord }

function hasChargedArea(item: Item): item is Item & { charge: NonNullable<Item['charge']> & { key: SpellKey } } {
  const charge = item.charge
  return !!charge && isSpellKey(charge.key) && charge.effects.some(isAreaEffect)
}

export function getChargeOptions(state: SceneState, action: ExplosionAction): ChargeOption[] {
  const range = getDetonationRange(state, action)
  const footprint = getPlacedFootprint(state, action.actorId)
  const all = getAllCharges(state, action.actorId)
  return range === null ? all : all.filter((o) => footprint !== null && setDistance([o.cell], footprint) <= range)
}

// The metres a detonation reaches from its caster: the spell's range, times
// the extensions the cast bought; null when nothing bounds it.
function getDetonationRange(state: SceneState, action: ExplosionAction): number | null {
  const cast = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  if (cast?.kind !== 'cast' || !isSpellKey(cast.key)) return null
  const detonate = SPELLS[cast.key].detonate
  return detonate ? detonate.range * (1 + cast.extend) : null
}

function getAllCharges(state: SceneState, actorId: string): ChargeOption[] {
  const held = Object.values(state.characters).flatMap((holder) => {
    const cell = state.board?.placements[holder.id]?.cell
    if (!cell) return []
    return (holder.id === actorId ? getReadyItems(holder) : holder.held).flatMap((item): ChargeOption[] => (hasChargedArea(item) ? [{ itemId: item.id, key: item.charge.key, holderId: holder.id, cell }] : []))
  })
  const onFloor = state.floor.flatMap((f): ChargeOption[] => (f.cell && hasChargedArea(f.item) ? [{ itemId: f.item.id, key: f.item.charge.key, holderId: null, cell: f.cell }] : []))
  return [...held, ...onFloor]
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
// outermost ring the graze, every ring between a hit; an area that does not
// graze has a hit there. (Past 5m of radius the book lets the table widen the
// outer zones, 30%/40%/30%; not done here.)
function getDiskZones(center: Coord, radius: number, grazes: boolean | undefined): ZoneCell[] {
  return Array.from({ length: radius + 1 }, (_, k) =>
    ring(center, k).map((cell): ZoneCell => ({ cell, degree: k === 0 ? 'critical' : grazes !== false && k === radius ? 'graze' : 'hit' })),
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
function getAreaZones(state: SceneState, action: BlastShape, area: Area): ZoneCell[] {
  if (area.shape === 'explosion') return action.center ? getDiskZones(action.center, area.radius, area.grazes) : []
  const from = state.board?.placements[action.actorId]
  const own = getPlacedFootprint(state, action.actorId) ?? []
  if (!from || action.direction === null) return []
  return getConeZones(from.cell, action.direction, area.length, area.angle).filter((z) => !own.some((o) => sameCell(o, z.cell)))
}

// Every cell the explosion may reach as declared: the disks about its
// centre; for a spray, the cone once it is aimed and, until then, everything
// in its length of the attacker (combat.tex "Sprays": "target all
// characters in range"), less the attacker's own footprint.
export function getThreatenedCells(state: SceneState, action: BlastShape): Coord[] {
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
export function getExplosionZones(state: SceneState, action: BlastShape): ZoneCell[] {
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
// one area where it stands now, and the wall that breaks between it and
// where the area goes off; null outside it, or behind total cover from there (combat.tex
// "Cover": "A character can protect themselves against projectiles and
// explosion attacks") — a wall that breaks lets it through, to be absorbed.
function getZoneOf(state: SceneState, action: BlastShape, id: string, area: Area): { degree: Degree; wall: Damage['wall'] } | null {
  const footprint = getPlacedFootprint(state, id)
  if (!footprint) return null
  const zones = new Map(getAreaZones(state, action, area).map((z) => [coordKey(z.cell), z.degree]))
  const degree = worstOf(footprint.map((cell) => zones.get(coordKey(cell)) ?? null))
  if (!degree) return null
  const origin = getBlastOrigin(state, action, area.shape === 'spray')
  const cover = origin ? getCover(state, origin, id) : null
  return cover?.kind === 'total' ? null : { degree, wall: toDamageWall(cover) }
}

// combat.tex "Cover": where the area goes off, which cover is reckoned from —
// the centre of a disk, the attacker for a spray.
function getBlastOrigin(state: SceneState, action: Pick<BlastShape, 'actorId' | 'center'>, spray: boolean): Coord[] | null {
  return spray ? getPlacedFootprint(state, action.actorId) : action.center ? [action.center] : null
}

// Everyone the explosion may reach as declared, the attacker included when
// they stand in it: whoever's footprint touches a threatened cell.
export function getThreatenedIds(state: SceneState, action: BlastShape): string[] {
  const threatened = new Set(getThreatenedCells(state, action).map(coordKey))
  return Object.keys(state.characters).filter((id) => (getPlacedFootprint(state, id) ?? []).some((cell) => threatened.has(coordKey(cell))))
}

// Everyone the explosion reaches, with the worst zone each is in, as the
// board stands.
export function getAffected(state: SceneState, action: BlastShape): { id: string; degree: Degree }[] {
  return Object.keys(state.characters).flatMap((id) => {
    const degree = worstOf(getExplosionAreas(action).map((area) => getZoneOf(state, action, id, area)?.degree ?? null))
    return degree ? [{ id, degree }] : []
  })
}

// What reaches each character in the area: every effect whose area they
// stand in, at that zone's degree, made by whoever set it off (spells.tex
// "Casting spells"; gear.tex "Explosion": "applies the weapon's damage ...
// and any other effects"). What goes to the ground is not here. Damage
// carries the wall that breaks in its way (combat.tex "Cover").
export function getExplosionFacts(state: SceneState, action: BlastShape, explosionId: string | null = null): Deliveries {
  const producer = state.characters[action.actorId]
  if ((!producer && !action.gm) || action.paintOnly) return {}
  const facts: Deliveries = {}
  for (const id of Object.keys(state.characters)) {
    const blocked = explosionId ? getExplosionBlock(state, explosionId, id) : null
    const deliveries = action.effects.flatMap((e): Delivery[] => {
      if (!e.area || e.type === 'terrain' || (!producer && e.type === 'spirit')) return []
      const zone = getZoneOf(state, action, id, e.area)
      if (!zone) return []
      const delivery = { ...(producer ? produceSpellEffect(producer, e) : produceUnownedEffect(e as Exclude<typeof e, { type: 'spirit' }>)), degree: zone.degree, test: null }
      if (delivery.effect.type !== 'damage') return [delivery]
      return [{ ...delivery, effect: { ...delivery.effect, effect: { ...delivery.effect.effect, ...blocked, wall: zone.wall } } }]
    })
    if (deliveries.length > 0) facts[id] = deliveries
  }
  return facts
}

// combat.tex "Explosion Block": "If successful or critical, the explosion
// damage gets reduced by the defenses from the shield" — what the shield
// the reactor blocked with absorbs, once their test came to a hit or better;
// null when they did not block or the test failed.
function getExplosionBlock(state: SceneState, explosionId: string, id: string): Defense | null {
  const block = getReactionsTo(state, explosionId).find((r) => r.actorId === id && r.kind === 'blockExplosion')
  const reactor = state.characters[id]
  if (block?.kind !== 'blockExplosion' || !reactor || (block.roll?.degree !== 'hit' && block.roll?.degree !== 'critical')) return null
  const row = findWeaponRow(reactor, block.weaponKey, block.attack)
  if (!row) return null
  return { defense: 'blockExplosion', defenseAP: block.cost?.AP ?? 0, defenseWeaponKey: block.weaponKey, block: getBlockValue(row.atk, row.weapon, reactor) ?? 0, blockCap: row.atk.RES, shield: true }
}

// combat.tex "Gas", "Fire": what the explosion leaves on the ground, cell
// by cell — each terrain effect's patch for the zone the cell is in. A patch
// that ignites leaves a surface burning with what the explosion's own burn
// deals there (spells.tex "Flamethrower": the surface deals the same damage
// as the initial hit, the table's ruling).
export function getTerrainPaint(state: SceneState, action: BlastShape): { cell: Coord; hazard: Hazard }[] {
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
function getBurns(state: SceneState, action: BlastShape): Map<string, number> {
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
// effects say the target rolls against (the worst of them); a detonation
// leaves no test at all. The producer's skill in it takes the sensory
// penalty of aiming where it goes off (combat.tex "Targeted actions") when
// it was aimed at a spot: thrown there or cast there, not set off where it
// lay by a blow, and never a spray (the table's ruling).
export function getExplosionDLTerms(state: SceneState, action: ExplosionAction): Term[] {
  const payload = getExplosionPayload(state, action)
  if (!payload) return []
  if (action.source === 'gm') return [{ label: 'GM', value: action.dl }]
  const caster = payload.producer
  if (!caster) return []
  const producer = caster.id
  const at = action.center && !isSpray(getBlastOf(state, action)) ? [action.center] : null
  if (action.source === 'thrown') {
    const aimed = action.spawnedBy ? getAction(state, action.spawnedBy)?.kind === 'throw' : false
    return [{ label: 'accuracy', value: getAccuracy(caster) }, ...(aimed && at ? getSensoryTerms(state, producer, 'accuracy', at, 'active') : [])]
  }
  if (action.source === 'detonate') return []
  const DLs = payload.effects.flatMap((e) => (e.resist ? [{ dl: e.resist.dl, value: resolveDL(caster, e.resist.dl, e.resist.roll).value ?? 0 }] : []))
  const worst = DLs.reduce<(typeof DLs)[number] | null>((w, d) => (w === null || d.value > w.value ? d : w), null)
  return worst ? [{ label: 'spell', value: worst.value }, ...(at ? getSensoryTermsOfDL(state, producer, worst.dl, at, 'active') : [])] : []
}

// Whether anyone can react to it: a thrown or cast explosion is defended
// with a reflex test (combat.tex "Explosions"); one set off from hiding is
// not — "If the explosion occurs before being perceived, no test can be
// made."
export function isAvoidable(action: ExplosionAction): boolean {
  return action.source !== 'detonate'
}

// Where a disk explosion may be aimed. Cast: within the effects' range of
// the caster, in sight, off blocking ground — the explosion is the spell's
// effect, which Extend does not reach. Thrown or detonated: where the
// object is — whoever holds it stands, or the cell it lies on if it is on
// the floor. Nowhere for a spray, which is aimed by direction.
export function getExplosionCenters(state: SceneState, action: ExplosionAction): Coord[] {
  return getCentersOf(state, action, getExplosionPayload(state, action))
}

function getCentersOf(state: SceneState, action: ExplosionAction, payload: Payload | null): Coord[] {
  if (!state.board || !payload || isSpray(toBlast(action, payload))) return []
  if (action.source === 'gm') return action.center ? [action.center] : []
  if (action.source !== 'cast') {
    const held = findReadyObject(state, action.itemId)
    if (held) return getPlacedFootprint(state, held.holder.id) ?? []
    const floored = findFloorItem(state, action.itemId)
    return floored?.cell ? [floored.cell] : []
  }
  return getAimableCells(state, action.actorId, Math.min(...payload.effects.map((e) => e.range ?? 1)), seesAcross)
}

// Whether the area is still its actor's to point, and can be pointed
// somewhere else: a disk until they commit to the explosion, a spray until
// the blast is confirmed (combat.tex "Sprays": "The attacker can choose the
// exact direction of the cone after the movement").
export function isAimable(state: SceneState, action: ExplosionAction | BlastAction): boolean {
  if (action.kind === 'blast') return action.step === 'post' && isSpray(action)
  const blast = getBlastOf(state, action)
  return getExplosionAreas(blast).length > 0 && action.step === 'define' && !isSpray(blast)
}

// Whether the explosion as declared is aimed: a disk at a centre it may be
// aimed at, a spray at nothing yet.
export function isAimed(state: SceneState, action: ExplosionAction): boolean {
  const payload = getExplosionPayload(state, action)
  if (!payload) return false
  if (isSpray(toBlast(action, payload))) return true
  return action.center !== null && getCentersOf(state, action, payload).some((c) => sameCell(c, action.center!))
}
