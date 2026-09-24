import type { Character, Damage, Delivery, WeaponAttack } from '../../types'
import type { Action, CombatState, DragAction, DragFacts, Grapple, GrappleAction, GrappleFacts, GrappleManeuver, Placement, ReleaseAction, StrikeAction } from '../types'
import { GRAPPLE_AFFLICTIONS } from '../../lists'
import { getWieldedWeapons } from '../../item/rules/hands'
import { getStrikeDamage } from '../../character/rules/gear'
import { getAfflictions } from '../../character/rules/afflictions'
import { getForce, getGrapple } from '../../character/rules/skills'
import { getHardness } from '../../item/rules/items'
import { Term, sumTerms } from '../../character/rules/terms'
import { hasProperty } from '../../weaponProperties'
import { DIRECTIONS, add, coordKey } from '../geometry'
import { findWeaponRow, getReactionsTo, isRowUsable, type WeaponRow } from './action'
import { canStandAt } from './move'

type GrappleAffliction = (typeof GRAPPLE_AFFLICTIONS)[number]

// ---------------------------------------------------------------------------
// Who is in a grapple with whom

export function findGrapple(grapples: Grapple[], a: string, b: string): Grapple | null {
  return grapples.find((g) => g.members.includes(a) && g.members.includes(b) && a !== b) ?? null
}

export function getGrapplesOf(state: CombatState, id: string): Grapple[] {
  return state.grapples.filter((g) => g.members.includes(id))
}

export function isInGrapple(state: CombatState, id: string): boolean {
  return getGrapplesOf(state, id).length > 0
}

export function getPartner(g: Grapple, id: string): string {
  return g.members[0] === id ? g.members[1] : g.members[0]
}

export function getPartners(state: CombatState, id: string): string[] {
  return getGrapplesOf(state, id).map((g) => getPartner(g, id))
}

export function holds(g: Grapple, holderId: string): boolean {
  return g.holds[holderId] !== undefined
}

// ---------------------------------------------------------------------------
// Grapple rows

// gear.tex "Grapple I/II": "This attack is used for grappling actions."
export function isGrappleRow(atk: WeaponAttack): boolean {
  return hasProperty(atk.properties, 'grapple I') || hasProperty(atk.properties, 'grapple II')
}

// Every grapple row the character can use right now — a free hand among
// them (gear.tex "Unarmed"). A grapple II row first: it is the one that
// deals damage (gear.tex "Grapple II deals damage normally").
export function getGrappleRows(c: Character): WeaponRow[] {
  return getWieldedWeapons(c)
    .flatMap((wielded) => wielded.weapon.attacks.map((atk) => ({ wielded, weapon: wielded.weapon, atk })))
    .filter((row) => isGrappleRow(row.atk) && isRowUsable(c, row))
    .sort((a, b) => Number(hasProperty(b.atk.properties, 'grapple II')) - Number(hasProperty(a.atk.properties, 'grapple II')))
}

export function hasGrappleRow(c: Character): boolean {
  return getGrappleRows(c).length > 0
}

// ---------------------------------------------------------------------------
// What a grapple puts on its members

// combat.tex "Initiate the Grab": held by a partner, a character is
// grappled — "If a creature's grapple skill is 10 points higher than its
// oponents, it does not suffer the grappled affliction."
function isGrappledBy(state: CombatState, g: Grapple, id: string): boolean {
  const partnerId = getPartner(g, id)
  const c = state.characters[id]
  const partner = state.characters[partnerId]
  if (!c || !partner || !holds(g, partnerId)) return false
  return getGrapple(c) < getGrapple(partner) + 10
}

function afflictionsOf(state: CombatState, grapples: Grapple[], id: string): Set<GrappleAffliction> {
  const own = grapples.filter((g) => g.members.includes(id))
  const set = new Set<GrappleAffliction>()
  if (own.some((g) => isGrappledBy(state, g, id))) set.add('grappled')
  if (own.some((g) => g.immobile.includes(id))) set.add('immobile')
  return set
}

// The facts of replacing the pair's grapple with `next`: what the change
// puts on and takes off each member, as every grapple they are in stands
// before and after, plus whatever else the action lands (a knockdown's
// prone, the holds' damage).
function settle(state: CombatState, pair: [string, string], next: Grapple | null, extra: Partial<Pick<GrappleFacts, 'on' | 'deliveries'>> = {}): GrappleFacts {
  const before = state.grapples
  const after = [...before.filter((g) => !(g.members.includes(pair[0]) && g.members.includes(pair[1]))), ...(next ? [next] : [])]
  const on: GrappleFacts['on'] = {}
  const off: GrappleFacts['off'] = {}
  for (const id of pair) {
    const was = afflictionsOf(state, before, id)
    const now = afflictionsOf(state, after, id)
    const added = [...now].filter((a) => !was.has(a)).concat(extra.on?.[id] ?? [])
    const removed = [...was].filter((a) => !now.has(a))
    if (added.length > 0) on[id] = [...new Set(added)]
    if (removed.length > 0) off[id] = removed
  }
  return { pair, grapple: next, on, off, deliveries: extra.deliveries ?? {} }
}

// ---------------------------------------------------------------------------
// Initiate the Grab

// combat.tex "Initiate the Grab": "attackers must make a strike test with a
// weapon that has the grapple property ... On a hit, the opponent is
// grappled". "It is possible to grapple back automatically just by having a
// weapon with grappling property equipped" — the target holds back with
// their own grapple row, if they have one and do not hold already.
export function getGrabFacts(state: CombatState, strike: StrikeAction): GrappleFacts | null {
  if (!strike.grab || !strike.targetId || (strike.roll?.degree !== 'hit' && strike.roll?.degree !== 'critical')) return null
  const target = state.characters[strike.targetId]
  if (!target) return null
  const pair: [string, string] = [strike.actorId, strike.targetId]
  const was = findGrapple(state.grapples, ...pair)
  const back = was?.holds[target.id] ?? getGrappleRows(target).map((r) => ({ weaponKey: r.wielded.key, attack: r.atk.name }))[0]
  const grapple: Grapple = {
    members: was?.members ?? pair,
    holds: { ...was?.holds, [strike.actorId]: { weaponKey: strike.weaponKey, attack: strike.attack }, ...(back ? { [target.id]: back } : {}) },
    immobile: was?.immobile ?? [],
  }
  return settle(state, pair, grapple)
}

// Whether the strike may be a grab at the target: made with a grapple row,
// at someone the attacker does not hold yet.
export function canGrab(state: CombatState, strike: Pick<StrikeAction, 'actorId' | 'weaponKey' | 'attack'>, targetId: string): boolean {
  const c = state.characters[strike.actorId]
  const row = c ? findWeaponRow(c, strike.weaponKey, strike.attack) : null
  const g = findGrapple(state.grapples, strike.actorId, targetId)
  return row !== null && isGrappleRow(row.atk) && !(g && holds(g, strike.actorId))
}

// ---------------------------------------------------------------------------
// Attack and Defend

// combat.tex "Attack and Defend": "Strikes between opponents involved in a
// grapple can be done with short range attacks."
export function isGrappleReach(state: CombatState, strike: StrikeAction, targetId: string): boolean {
  if (!findGrapple(state.grapples, strike.actorId, targetId)) return true
  const c = state.characters[strike.actorId]
  const row = c ? findWeaponRow(c, strike.weaponKey, strike.attack) : null
  return row === null || row.atk.range === 'short'
}

// combat.tex "Attack and Defend": "Any attacks with the grappling property
// can use the grapple skill instead of strike to attack during a grapple" —
// the better of the two.
export function getGrappleStrikeTerm(state: CombatState, strike: StrikeAction): Term | null {
  const c = state.characters[strike.actorId]
  const row = c ? findWeaponRow(c, strike.weaponKey, strike.attack) : null
  if (!c || !row || !isGrappleRow(row.atk) || !strike.targetId || !findGrapple(state.grapples, strike.actorId, strike.targetId)) return null
  return { label: 'grapple', value: getGrapple(c) }
}

// ---------------------------------------------------------------------------
// Grapple Maneuvers

// The partners a maneuver can be made against: escape is from someone who
// holds the actor; the others are at anyone the actor is in a grapple with.
export function getManeuverTargets(state: CombatState, actorId: string, maneuver: GrappleManeuver): string[] {
  return getGrapplesOf(state, actorId)
    .filter((g) => maneuver !== 'escape' || holds(g, getPartner(g, actorId)))
    .map((g) => getPartner(g, actorId))
}

function isResisted(state: CombatState, root: Action): boolean {
  return getReactionsTo(state, root.id).some((r) => r.kind === 'resist' && r.actorId === root.targetId)
}

// combat.tex "Grapple Maneuvers": "must be defended with the grapple skill,
// and require the defender to spend 2 AP+1 STA or suffer a -5 penalty".
export function getManeuverDLTerms(state: CombatState, root: GrappleAction): Term[] {
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  if (!defender) return []
  return [
    { label: 'grapple', value: getGrapple(defender) },
    ...(isResisted(state, root) ? [] : [{ label: 'no resistance', value: -5 }]),
  ]
}

// combat.tex "Grapple Maneuvers": "If the grapple attack has any damage, it
// deals that damage whenever a grapple maneuver is used, regardless of who
// initiated it or the test's result." Each hold's row lands on the partner
// it holds, at a hit to the chest, undefended.
function getHoldDeliveries(state: CombatState, g: Grapple): Record<string, Delivery[]> {
  const out: Record<string, Delivery[]> = {}
  for (const holderId of g.members) {
    const hold = g.holds[holderId]
    const holder = state.characters[holderId]
    const row = hold && holder ? findWeaponRow(holder, hold.weaponKey, hold.attack) : null
    if (!row || !holder) continue
    const { blunt, cut } = getStrikeDamage(row.atk, row.weapon, holder)
    if (blunt <= 0 && cut <= 0) continue
    const damage: Damage = {
      damage: [{ kind: 'blunt', value: blunt }, { kind: 'cut', value: cut }],
      hardness: getHardness(row.atk.material),
      force: getForce(holder),
      properties: row.atk.properties,
      location: 'chest',
      defense: 'none',
      defenseAP: 0,
      defenseWeaponKey: '',
      block: 0,
      shield: false,
      bypass: false,
      bust: false,
      smash: false,
    }
    const heldId = getPartner(g, holderId)
    out[heldId] = [...(out[heldId] ?? []), { effect: { name: `${row.weapon.name} ${row.atk.name}`, trigger: 'instant', type: 'damage', effect: damage }, degree: 'hit', test: null, when: null, then: [], locks: null }]
  }
  return out
}

// combat.tex "Escape": "Escapes from the grapple on criticals and hits."
// "Knockdown: The opponent falls to the ground on a critical. It is possible
// to throw oneself along to achieve a knockdown on a hit." "Immobilize: The
// opponent becomes immobilized on a critical. It is possible to stay
// immobilized yourself to achieve immobilization on a hit."
export function getManeuverFacts(state: CombatState, root: GrappleAction): GrappleFacts | null {
  if (!root.targetId || !root.roll) return null
  const g = findGrapple(state.grapples, root.actorId, root.targetId)
  if (!g) return null
  const pair: [string, string] = [root.actorId, root.targetId]
  const deliveries = getHoldDeliveries(state, g)
  const degree = root.roll.degree
  const landed = degree === 'critical' || (degree === 'hit' && root.along)
  const who = degree === 'critical' ? [root.targetId] : [root.targetId, root.actorId]
  switch (root.maneuver) {
    case 'escape':
      return settle(state, pair, degree === 'critical' || degree === 'hit' ? null : g, { deliveries })
    case 'knockdown':
      return settle(state, pair, g, { deliveries, on: landed ? Object.fromEntries(who.map((id) => [id, ['prone']])) : {} })
    case 'immobilize':
      return settle(state, pair, landed ? { ...g, immobile: [...new Set([...g.immobile, ...who])] } : g, { deliveries })
  }
}

// ---------------------------------------------------------------------------
// Letting go

// A holder may let go of a partner who does not hold them back; one who is
// held too has to escape.
export function getReleaseTargets(state: CombatState, actorId: string): string[] {
  return getGrapplesOf(state, actorId)
    .filter((g) => holds(g, actorId) && !holds(g, getPartner(g, actorId)))
    .map((g) => getPartner(g, actorId))
}

export function getReleaseFacts(state: CombatState, root: ReleaseAction): GrappleFacts | null {
  const g = root.targetId ? findGrapple(state.grapples, root.actorId, root.targetId) : null
  if (!g || !root.targetId) return null
  return settle(state, [root.actorId, root.targetId], null)
}

// ---------------------------------------------------------------------------
// Push and drag

// combat.tex "Push and drag": "a force vs force comparison. The strongest
// pushes the other by up to 1m. On a force difference equal or greater than
// 5, push them 2m. The defender must spend 2AP+1STA or receive -5 in this
// comparison. Nobody moves on a draw." The pair moves together; a defender
// who did not resist only stops the push, and one who did and wins pushes
// the attacker straight back. Each step is taken only where both can stand.
export function getDragTerms(state: CombatState, root: DragAction): { attacker: Term[]; defender: Term[] } {
  const actor = state.characters[root.actorId]
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  return {
    attacker: actor ? [{ label: 'force', value: getForce(actor) }] : [],
    defender: defender ? [{ label: 'force', value: getForce(defender) }, ...(isResisted(state, root) ? [] : [{ label: 'no resistance', value: -5 }])] : [],
  }
}

export function getDragFacts(state: CombatState, root: DragAction): DragFacts | null {
  const board = state.board
  const actor = state.characters[root.actorId]
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  if (!board || !actor || !defender || root.direction === null) return null
  const { attacker, defender: resisting } = getDragTerms(state, root)
  const diff = sumTerms(attacker) - sumTerms(resisting)
  if (diff === 0 || (diff < 0 && !isResisted(state, root))) return { steps: 0, to: {} }
  const allowed = Math.abs(diff) >= 5 ? 2 : 1
  const steps = diff > 0 ? Math.min(root.steps, allowed) : allowed
  const heading = DIRECTIONS[diff > 0 ? root.direction : (root.direction + 3) % 6]
  const ids = [actor.id, defender.id]
  let where: Record<string, Placement> = Object.fromEntries(ids.flatMap((id) => (board.placements[id] ? [[id, board.placements[id]]] : [])))
  if (Object.keys(where).length < 2) return { steps: 0, to: {} }
  let taken = 0
  for (let i = 0; i < steps; i++) {
    const next: Record<string, Placement> = Object.fromEntries(ids.map((id) => {
      const cell = add(where[id].cell, heading)
      return [id, { ...where[id], cell, elevation: board.terrain[coordKey(cell)]?.elevation ?? 0 }]
    }))
    const moved = { ...state, board: { ...board, placements: { ...board.placements, ...next } } }
    if (!ids.every((id) => canStandAt(moved, id, next[id]))) break
    where = next
    taken++
  }
  return { steps: taken, to: taken > 0 ? where : {} }
}

// ---------------------------------------------------------------------------
// Immobile

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
export function isImmobile(c: Character): boolean {
  return getAfflictions(c).includes('immobile')
}

export function isGrappleRowOf(c: Character, weaponKey: string, attack: string): boolean {
  const row = findWeaponRow(c, weaponKey, attack)
  return row !== null && isGrappleRow(row.atk)
}
