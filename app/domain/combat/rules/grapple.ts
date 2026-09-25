import type { Character, WeaponAttack } from '../../types'
import type { Action, CombatState, Deliveries, DragAction, DragFacts, Grapple, GrappleAction, GrappleFacts, GrappleManeuver, Coord, HoldBackAction, Placement, ReleaseAction, StrikeAction } from '../types'
import { GRAPPLE_AFFLICTIONS } from '../../lists'
import { ASSIST } from '../../tables'
import { getStrikeDamage } from '../../character/rules/gear'
import { getAfflictions } from '../../character/rules/afflictions'
import { getForce, getGrapple } from '../../character/rules/skills'
import { getSize } from '../../character/rules/misc'
import { Term, sumTerms } from '../../character/rules/terms'
import { hasProperty, isMeleeRange } from '../../weaponProperties'
import { DIRECTIONS, add, sameCell, setDistance, walkOut } from '../geometry'
import { getFootprint, getPlacedFootprint, getReach, placeAt, withPlacements } from './board'
import { getReactionsTo } from './action'
import { getFightName } from './activeCharacter'
import { findWeaponRow, getWeaponRows, isRowUsable, type WeaponRow } from './weaponRow'
import { canStandAt, getMoveCost } from './move'
import { delivering, getRowDamage } from './damage'
import { isAttackAction } from './attack'

type GrappleAffliction = (typeof GRAPPLE_AFFLICTIONS)[number]

// ---------------------------------------------------------------------------
// Who is in a grapple with whom

export function findGrapple(grapples: Grapple[], a: string, b: string): Grapple | null {
  return grapples.find((g) => a !== b && g.members.includes(a) && g.members.includes(b)) ?? null
}

function getGrapplesOf(state: CombatState, id: string): Grapple[] {
  return state.grapples.filter((g) => g.members.includes(id))
}

export function isInGrapple(state: CombatState, id: string): boolean {
  return getGrapplesOf(state, id).length > 0
}

function getPartner(g: Grapple, id: string): string {
  return g.members[0] === id ? g.members[1] : g.members[0]
}

export function getPartners(state: CombatState, id: string): string[] {
  return getGrapplesOf(state, id).map((g) => getPartner(g, id))
}

export function holds(g: Grapple, holderId: string): boolean {
  return g.holders.includes(holderId)
}

// Whether anyone holds the character.
export function isHeld(grapples: Grapple[], id: string): boolean {
  return grapples.some((g) => g.members.includes(id) && holds(g, getPartner(g, id)))
}

// Everyone locked together with the character through any chain of
// grapples, the character included (combat.tex "Push and drag": all of them
// are dragged).
export function getGrappleGroup(grapples: Grapple[], id: string): string[] {
  const group = new Set([id])
  const queue = [id]
  while (queue.length > 0) {
    const next = queue.pop()!
    for (const g of grapples) {
      if (!g.members.includes(next)) continue
      const other = getPartner(g, next)
      if (!group.has(other)) {
        group.add(other)
        queue.push(other)
      }
    }
  }
  return [...group]
}

// ---------------------------------------------------------------------------
// Grapple rows

// gear.tex "Grapple I/II": "This attack is used for grappling actions."
function isGrappleRow(atk: WeaponAttack): boolean {
  return hasProperty(atk.properties, 'grapple I') || hasProperty(atk.properties, 'grapple II')
}

// Every grapple row the character can use right now, as they hold it — a
// Bardiche's shaft only in both hands, a free hand among them (gear.tex
// "Unarmed") — grapple II first: it is the one that deals damage (gear.tex
// "Grapple II deals damage normally").
function getGrappleRows(c: Character): WeaponRow[] {
  return getWeaponRows(c)
    .filter((row) => isGrappleRow(row.atk) && isRowUsable(c, row))
    .sort((a, b) => Number(hasProperty(b.atk.properties, 'grapple II')) - Number(hasProperty(a.atk.properties, 'grapple II')))
}

function hasGrappleRow(c: Character): boolean {
  return getGrappleRows(c).length > 0
}

export function isGrappleRowOf(c: Character, weaponKey: string, attack: string): boolean {
  const row = findWeaponRow(c, weaponKey, attack)
  return row !== null && isGrappleRow(row.atk)
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

function getGrappleAfflictions(state: CombatState, grapples: Grapple[], id: string): GrappleAffliction[] {
  const own = grapples.filter((g) => g.members.includes(id))
  return [
    ...(own.some((g) => isGrappledBy(state, g, id)) ? ['grappled' as const] : []),
    ...(own.some((g) => g.immobile.includes(id)) ? ['immobile' as const] : []),
  ]
}

// What going from one set of grapples to another puts on and takes off each
// of `ids`.
export function diffGrappleAfflictions(state: CombatState, before: Grapple[], after: Grapple[], ids: readonly string[]): Pick<GrappleFacts, 'on' | 'off'> {
  const on: GrappleFacts['on'] = {}
  const off: GrappleFacts['off'] = {}
  for (const id of ids) {
    const was = getGrappleAfflictions(state, before, id)
    const now = getGrappleAfflictions(state, after, id)
    const added = now.filter((a) => !was.includes(a))
    const removed = was.filter((a) => !now.includes(a))
    if (added.length > 0) on[id] = added
    if (removed.length > 0) off[id] = removed
  }
  return { on, off }
}

// The grapples as they stand once every holder with nothing left to hold
// with has let go ("the grapplers must have a grapple property attack at
// all times"), and every grapple nobody holds any more is over.
export function getHeldGrapples(state: CombatState, grapples: Grapple[]): Grapple[] {
  return dropHolders(grapples, (id) => !state.characters[id] || !hasGrappleRow(state.characters[id]))
}

// The grapples once every holder `letsGo` says lets go has, and any grapple
// nobody holds any more is over.
export function dropHolders(grapples: Grapple[], letsGo: (id: string) => boolean): Grapple[] {
  return grapples
    .map((g) => ({ ...g, holders: g.holders.filter((id) => !letsGo(id)) }))
    .filter((g) => g.holders.length > 0)
}

// What a grab, a maneuver, a letting go or a grappling back wrote down about
// the grapple.
export function getGrappleFacts(action: Action): GrappleFacts | null {
  if (action.kind === 'strike') return action.grabbed
  if (action.kind === 'grapple' || action.kind === 'release' || action.kind === 'holdBack') return action.facts
  return null
}

// The grapples with the pair's replaced by `next`, or gone for null.
export function replacePair(grapples: Grapple[], pair: readonly [string, string], next: Grapple | null): Grapple[] {
  const rest = grapples.filter((g) => !(g.members.includes(pair[0]) && g.members.includes(pair[1])))
  return next ? [...rest, next] : rest
}

function facts(state: CombatState, pair: [string, string], next: Grapple | null, extra: Partial<GrappleFacts> = {}): GrappleFacts {
  const after = replacePair(state.grapples, pair, next)
  return { pair, grapple: next, prone: [], stand: [], dropped: null, seized: null, freed: [], deliveries: {}, ...extra, ...diffGrappleAfflictions(state, state.grapples, after, pair) }
}

// ---------------------------------------------------------------------------
// Initiate the Grab

// combat.tex "Initiate the Grab": "attackers must make a strike test with a
// weapon that has the grapple property ... On a hit, the opponent is
// grappled". "It is possible to grapple back automatically just by having a
// weapon with grappling property equipped."
export function getGrabFacts(state: CombatState, strike: StrikeAction): GrappleFacts | null {
  if (!strike.grab || !strike.targetId || strike.roll?.degree !== 'hit') return null
  const target = state.characters[strike.targetId]
  if (!target) return null
  const pair: [string, string] = [strike.actorId, strike.targetId]
  const was = findGrapple(state.grapples, ...pair)
  const holders = [...new Set([...(was?.holders ?? []), strike.actorId, ...(hasGrappleRow(target) ? [target.id] : [])])]
  return facts(state, pair, { members: was?.members ?? pair, holders, immobile: was?.immobile ?? [], seized: was?.seized ?? [] })
}

// Whether the strike may be a grab at the target: made with a grapple row,
// at someone the attacker does not hold yet.
export function canGrab(state: CombatState, strike: Pick<StrikeAction, 'actorId' | 'weaponKey' | 'attack'>, targetId: string): boolean {
  const c = state.characters[strike.actorId]
  const g = findGrapple(state.grapples, strike.actorId, targetId)
  return !!c && isGrappleRowOf(c, strike.weaponKey, strike.attack) && !(g && holds(g, strike.actorId))
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
  if (!c || !strike.targetId || !isGrappleRowOf(c, strike.weaponKey, strike.attack) || !findGrapple(state.grapples, strike.actorId, strike.targetId)) return null
  return { label: 'grapple', value: getGrapple(c) }
}

// ---------------------------------------------------------------------------
// Grapple Maneuvers

// The partners a maneuver can be made against: an escape from the grapple
// is from someone who holds the actor; everything else — standing up
// included — at anyone the actor is in a grapple with.
export function getManeuverTargets(state: CombatState, actorId: string, maneuver: GrappleManeuver, stand = false): string[] {
  return getGrapplesOf(state, actorId)
    .filter((g) => maneuver !== 'escape' || stand || holds(g, getPartner(g, actorId)))
    .map((g) => getPartner(g, actorId))
}

// combat.tex "Escape is also used for trying to stand up while grappled".
export function canStandByEscape(state: CombatState, c: Character): boolean {
  return isInGrapple(state, c.id) && getAfflictions(c).includes('prone')
}

function isResisted(state: CombatState, root: Action): boolean {
  return getReactionsTo(state, root.id).some((r) => r.kind === 'resist' && r.actorId === root.targetId)
}

// combat.tex "Grapple Maneuvers": "must be defended with the grapple skill,
// and require the defender to interrupt itself and spend 2 AP+1 STA or
// suffer a -5 penalty"; made as an opportunity attack, "the -2 penalty to
// defense" — on an active defense, as a strike's is.
export function getManeuverDLTerms(state: CombatState, root: GrappleAction): Term[] {
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  if (!defender) return []
  const resisted = isResisted(state, root)
  return [
    { label: 'grapple', value: getGrapple(defender) },
    ...(resisted ? [] : [{ label: 'no resistance', value: -5 }]),
    ...(resisted && root.opportunity ? [{ label: 'opportunity', value: -2 }] : []),
  ]
}

// combat.tex "Grapple Maneuvers": "If the grapple attack has any damage, it
// deals that damage whenever a grapple maneuver is used, regardless of who
// initiated it or the test's result." Each holder's best grapple row lands
// on the partner, at a hit to the chest, undefended.
function getHoldDeliveries(state: CombatState, g: Grapple): Deliveries {
  const out: Deliveries = {}
  for (const holderId of g.holders) {
    const holder = state.characters[holderId]
    const row = holder ? getGrappleRows(holder)[0] : undefined
    if (!row || !holder) continue
    const { blunt, cut } = getStrikeDamage(row.atk, row.weapon, holder)
    if (blunt <= 0 && cut <= 0) continue
    const damage = getRowDamage(holder, row, [{ kind: 'blunt', value: blunt }, { kind: 'cut', value: cut }], 'chest')
    const heldId = getPartner(g, holderId)
    out[heldId] = [...(out[heldId] ?? []), delivering(`${row.weapon.name} ${row.atk.name}`, damage, 'hit')]
  }
  return out
}

// What a disarm can go for: anything in the partner's hands — a natural
// weapon is not an item and cannot be taken.
export function getDisarmOptions(state: CombatState, root: GrappleAction): { itemId: string; name: string }[] {
  const target = root.targetId ? state.characters[root.targetId] : undefined
  return target ? target.held.map((i) => ({ itemId: i.id, name: i.name })) : []
}

// Whether a rolled maneuver's hit or critical still waits on the attacker's
// pick of what a disarm takes.
export function needsDisarmPick(state: CombatState, root: GrappleAction): boolean {
  const landed = root.roll?.degree === 'hit' || root.roll?.degree === 'critical'
  return root.maneuver === 'disarm' && landed && root.item === '' && getDisarmOptions(state, root).length > 0
}

// combat.tex "Escape": "Escapes from the grapple on criticals and hits ...
// Escape is also used for trying to stand up while grappled, but does not
// disolve the grapple when done that way." "Disarm: Removes something from
// the opponent's hands on a critical. It is possible to grab the opponent's
// weapon on a hit, preventing them from using it until they manage to win
// on a grapple maneuvre to release it or when they escape" — any maneuver
// its owner wins frees it, on top of what the maneuver does (the table's
// ruling). "Knockdown: The opponent falls to the ground on a critical. It
// is possible to throw oneself along to achieve a knockdown on a hit. Also
// works on a hit when knockdown is done from a prone position" — nobody
// else goes down with them then, the actor being down already.
// "Immobilize: The opponent becomes immobilized on a critical. It is
// possible to stay immobilized yourself to achieve immobilization on a
// hit." "If a grapple maneuvre grazes or misses, it simply has no effect."
export function getManeuverFacts(state: CombatState, root: GrappleAction): GrappleFacts | null {
  const done = getManeuverOutcome(state, root)
  const won = root.roll?.degree === 'hit' || root.roll?.degree === 'critical'
  return done && won ? freeSeized(state, root.actorId, done) : done
}

function freeSeized(state: CombatState, ownerId: string, done: GrappleFacts): GrappleFacts {
  const owner = state.characters[ownerId]
  const freed = done.grapple && owner ? done.grapple.seized.filter((id) => owner.held.some((i) => i.id === id)) : []
  if (!done.grapple || freed.length === 0) return done
  const { prone, stand, dropped, seized, deliveries } = done
  return facts(state, done.pair, { ...done.grapple, seized: done.grapple.seized.filter((id) => !freed.includes(id)) }, { prone, stand, dropped, seized, deliveries, freed })
}

function getManeuverOutcome(state: CombatState, root: GrappleAction): GrappleFacts | null {
  if (!root.targetId || !root.roll) return null
  const g = findGrapple(state.grapples, root.actorId, root.targetId)
  if (!g) return null
  const pair: [string, string] = [root.actorId, root.targetId]
  const deliveries = getHoldDeliveries(state, g)
  const degree = root.roll.degree
  const critical = degree === 'critical'
  const landed = critical || degree === 'hit'
  const along = critical || (degree === 'hit' && root.along)
  const who = critical ? [root.targetId] : [root.targetId, root.actorId]
  switch (root.maneuver) {
    case 'escape':
      if (root.stand) return facts(state, pair, g, { deliveries, stand: landed ? [root.actorId] : [] })
      return facts(state, pair, landed ? null : g, { deliveries })
    case 'knockdown': {
      const actor = state.characters[root.actorId]
      if (degree === 'hit' && actor && getAfflictions(actor).includes('prone')) return facts(state, pair, g, { deliveries, prone: [root.targetId] })
      return facts(state, pair, g, { deliveries, prone: along ? who : [] })
    }
    case 'immobilize':
      return facts(state, pair, along ? { ...g, immobile: [...new Set([...g.immobile, ...who])] } : g, { deliveries })
    case 'disarm': {
      const item = root.item && getDisarmOptions(state, root).some((o) => o.itemId === root.item) ? root.item : null
      if (!item || !landed) return facts(state, pair, g, { deliveries })
      if (critical) return facts(state, pair, g, { deliveries, dropped: { ownerId: root.targetId, itemId: item } })
      return facts(state, pair, { ...g, seized: [...new Set([...g.seized, item])] }, { deliveries, seized: item })
    }
  }
}

// combat.tex "Escape": "Being stunned allows for a reaction to escape
// without the possibility of active resistance." A holder the attack
// stunned gives whoever they hold an escape — but not the grabber from their
// own grab's blow.
export function getStunEscapes(state: CombatState, root: Action): { heldId: string; holderId: string }[] {
  if (!isAttackAction(root) || root.interruption !== 'stunned' || !root.targetId) return []
  const holderId = root.targetId
  return state.grapples
    .filter((g) => g.members.includes(holderId) && holds(g, holderId))
    .map((g) => getPartner(g, holderId))
    .filter((heldId) => !(root.kind === 'strike' && root.grabbed && heldId === root.actorId))
    .filter((heldId) => state.characters[heldId] !== undefined)
    .map((heldId) => ({ heldId, holderId }))
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
  return facts(state, [root.actorId, root.targetId], null)
}

// ---------------------------------------------------------------------------
// Grappling back

// combat.tex "Initiate the Grab": "It is possible to grapple back
// automatically just by having a weapon with grappling property equipped" —
// the partners the character holds nothing of, once they have a grapple row
// in hand.
export function getHoldBackTargets(state: CombatState, actorId: string): string[] {
  const c = state.characters[actorId]
  if (!c || !hasGrappleRow(c)) return []
  return getGrapplesOf(state, actorId).filter((g) => !holds(g, actorId)).map((g) => getPartner(g, actorId))
}

export function getHoldBackFacts(state: CombatState, root: HoldBackAction): GrappleFacts | null {
  const g = root.targetId ? findGrapple(state.grapples, root.actorId, root.targetId) : null
  if (!g || !root.targetId) return null
  return facts(state, [root.actorId, root.targetId], { ...g, holders: [...new Set([...g.holders, root.actorId])] })
}

// ---------------------------------------------------------------------------
// Push and drag

// combat.tex "Grapple": several characters on one side of a test use "the
// highest skill value among them plus 3/2/1 for each additional character,
// up to a maximum of 5", a smaller one adding at most 2.
function sideTerms(values: { id: string; value: number; label: string }[], helpers: string[], state: CombatState): Term[] {
  if (values.length === 0) return []
  const lead = values.reduce((best, v) => (v.value > best.value ? v : best))
  const leader = state.characters[lead.id]
  const others = helpers.filter((id) => id !== lead.id)
  const bonus = Math.min(ASSIST.max, others.reduce((sum, id, i) => {
    const step = ASSIST.bonus[Math.min(i, ASSIST.bonus.length - 1)]
    const smaller = leader && state.characters[id] && getSize(state.characters[id]) < getSize(leader)
    return sum + (smaller ? Math.min(step, ASSIST.smallerMax) : step)
  }, 0))
  return [{ label: lead.label, value: lead.value }, ...(bonus > 0 ? [{ label: 'help', value: bonus }] : [])]
}

export type DragSides = {
  // everyone who moves, the actor included
  movers: string[]
  attackers: string[]
  resisters: string[]
  active: string[]
  carriers: string[]
  released: string[]
  attacker: Term[]
  // null: nobody resists at all
  defender: Term[] | null
}

// combat.tex "Push and drag": everyone locked in the grapple with the actor
// is dragged, each as they answered — resisting actively (their Force) or
// passively (at -5), helping actively (on the actor's side), going along,
// or, held by nobody, letting go and staying behind. Made as an opportunity
// attack, an active defense is at -2.
export function getDragSides(state: CombatState, root: DragAction): DragSides {
  const reactions = getReactionsTo(state, root.id)
  const chose = (kind: Action['kind']) => new Set(reactions.filter((r) => r.kind === kind).map((r) => r.actorId))
  const [assist, carry, letGo, resist] = [chose('assist'), chose('carry'), chose('letGo'), chose('resist')]
  const released = [...letGo].filter((id) => !isHeld(state.grapples, id))
  const grapples = dropHolders(state.grapples, (id) => released.includes(id))
  const movers = getGrappleGroup(grapples, root.actorId)
  const attackers = movers.filter((id) => id === root.actorId || assist.has(id))
  const carriers = movers.filter((id) => carry.has(id) && !attackers.includes(id))
  const resisters = movers.filter((id) => !attackers.includes(id) && !carriers.includes(id))
  const active = resisters.filter((id) => resist.has(id))
  const force = (id: string) => (state.characters[id] ? getForce(state.characters[id]) : 0)
  const name = (id: string) => getFightName(state, id)
  const attacker = sideTerms(attackers.map((id) => ({ id, value: force(id), label: `${name(id)} force` })), attackers, state)
  const defender = resisters.length === 0 ? null : [
    ...sideTerms(resisters.map((id) => ({ id, value: force(id) - (active.includes(id) ? 0 : 5), label: `${name(id)} force${active.includes(id) ? '' : ' (passive)'}` })), active, state),
    ...(root.opportunity && active.length > 0 ? [{ label: 'opportunity', value: -2 }] : []),
  ]
  return { movers, attackers, resisters, active, carriers, released, attacker, defender }
}

// "The strongest pushes the other by up to 1m and interrupts them. On a
// force difference equal or greater than 5, push them 2m. ... Nobody moves
// on a draw. The defender can only move the attacker if they spent the
// cost." There is no die: once the grapple has answered, the outcome is
// settled — who won, and how far they may push. "Moving within the grapple
// area, without displacing the opponent, is possible if Force is no lower
// than 5 points lower than the opponent": the actor may circle round
// instead, as far as a push would have gone, unless pushed back.
export type DragOutcome = {
  sides: DragSides
  diff: number
  // the side the push moves against, interrupted by it
  pushed: string[]
  // how far a push may go; 0 when nobody can be pushed
  push: number
  // how far the actor may circle; 0 when they may not
  circle: number
}

export function getDragOutcome(state: CombatState, root: DragAction): DragOutcome | null {
  const actor = state.characters[root.actorId]
  if (!state.board || !actor) return null
  const sides = getDragSides(state, root)
  const diff = sides.defender === null ? Infinity : sumTerms(sides.attacker) - sumTerms(sides.defender)
  const back = diff < 0 && sides.active.length > 0
  const pushed = diff > 0 ? sides.resisters : back ? sides.attackers : []
  // with everyone else going along, nobody is pushed but the group still moves
  const moves = pushed.length > 0 || (diff > 0 && sides.carriers.length > 0)
  const far = Math.abs(diff) >= 5 ? 2 : 1
  return { sides, diff, pushed, push: moves ? far : 0, circle: !back && canMoveInGrapple(state, actor) ? (diff >= 5 ? 2 : 1) : 0 }
}

// The choices the outcome leaves the winner, each open or not.
export function getDragChoices(state: CombatState, root: DragAction): { choice: 'push' | 'circle' | 'stay'; available: boolean }[] {
  const outcome = getDragOutcome(state, root)
  return [
    { choice: 'push', available: (outcome?.push ?? 0) > 0 },
    { choice: 'circle', available: (outcome?.circle ?? 0) > 0 && getCircleCells(state, root).length > 0 },
    { choice: 'stay', available: true },
  ]
}

// Whether the winner still has to say which way: a choice to make, or one
// made that still has to be pointed on the board.
export function needsDragAim(state: CombatState, root: DragAction): boolean {
  if (!getDragChoices(state, root).some((c) => c.choice !== 'stay' && c.available)) return false
  return root.choice === null || (root.choice === 'push' && root.direction === null) || (root.choice === 'circle' && root.to === null)
}

// Where the actor may circle to: every cell within the reach circling
// allows, got to one free step at a time, inside the grapple area.
export function getCircleCells(state: CombatState, root: DragAction): { cell: Coord; path: Coord[] }[] {
  const board = state.board
  const from = board?.placements[root.actorId]
  const actor = state.characters[root.actorId]
  const outcome = getDragOutcome(state, root)
  if (!board || !from || !actor || !outcome || outcome.circle === 0) return []
  return walkOut(from.cell, (steps) => steps <= outcome.circle, (cell) => {
    const placement = placeAt(board, from, cell)
    return canStandAt(state, root.actorId, placement) && isInGrappleArea(state, root.actorId, getFootprint(actor, placement))
  })
}

// Where everyone moved stands after each step of the way chosen, in order:
// the whole group along the push, only as far as all of them can stand; or
// the actor alone, circling.
export function getDragPath(state: CombatState, root: DragAction): { outcome: DragOutcome; steps: Record<string, Placement>[] } | null {
  const board = state.board
  const outcome = getDragOutcome(state, root)
  if (!board || !outcome) return null
  if (root.choice === 'circle' && root.to) {
    const from = board.placements[root.actorId]
    const path = getCircleCells(state, root).find((c) => sameCell(c.cell, root.to!))?.path ?? []
    return { outcome, steps: path.map((cell) => ({ [root.actorId]: placeAt(board, from, cell) })) }
  }
  if (root.choice !== 'push' || root.direction === null || outcome.push === 0) return { outcome, steps: [] }
  const heading = DIRECTIONS[root.direction]
  let where: Record<string, Placement> = Object.fromEntries(outcome.sides.movers.flatMap((id) => (board.placements[id] ? [[id, board.placements[id]]] : [])))
  const steps: Record<string, Placement>[] = []
  for (let i = 0; i < Math.min(root.steps, outcome.push); i++) {
    const next: Record<string, Placement> = Object.fromEntries(Object.entries(where).map(([id, p]) => {
      const cell = add(p.cell, heading)
      return [id, placeAt(board, p, cell)]
    }))
    const moved = withPlacements(state, next)
    if (!Object.keys(next).every((id) => canStandAt(moved, id, next[id]))) break
    steps.push(next)
    where = next
  }
  return { outcome, steps }
}

// Whoever resisted actively "interrupt[ed] itself"; the side a push moved
// was interrupted by it.
export function getDragFacts(state: CombatState, root: DragAction): DragFacts | null {
  const path = getDragPath(state, root)
  if (!path) return null
  const { outcome: { sides, pushed }, steps } = path
  const taken = root.choice === 'push' ? steps.length : 0
  const interrupted = [...new Set([...(taken > 0 ? pushed : []), ...sides.active])]
  const carried = Object.fromEntries(sides.carriers.flatMap((id) => (state.characters[id] && taken > 0 ? [[id, getMoveCost(state.characters[id], 'basic', taken).AP]] : [])))
  return { steps: steps.length, to: steps.length > 0 ? steps[steps.length - 1] : {}, interrupted, released: sides.released, carried }
}

// ---------------------------------------------------------------------------
// Moving within the grapple

// combat.tex "Push and drag": "Moving within the grapple area, without
// displacing the opponent, is possible if Force is no lower than 5 points
// lower than the opponent" — than every partner's.
function canMoveInGrapple(state: CombatState, c: Character): boolean {
  return getPartners(state, c.id).every((id) => !state.characters[id] || getForce(c) >= getForce(state.characters[id]) - 5)
}

// The grapple area, as the table rules it: within reach of the grapple —
// the longest reach of any holder's grapple row, never under a cell.
function getGrappleReach(state: CombatState, g: Grapple): number {
  return Math.max(1, ...g.holders.flatMap((id) => {
    const holder = state.characters[id]
    return holder ? getGrappleRows(holder).flatMap((row) => (isMeleeRange(row.atk.range) ? [getReach(row.weapon, row.atk.range)] : [])) : []
  }))
}

// Whether a footprint of the character's keeps every partner on the board
// inside the grapple area.
function isInGrappleArea(state: CombatState, id: string, footprint: Coord[]): boolean {
  return getGrapplesOf(state, id).every((g) => {
    const partner = getPlacedFootprint(state, getPartner(g, id))
    return !partner || setDistance(footprint, partner) <= getGrappleReach(state, g)
  })
}

// ---------------------------------------------------------------------------
// Immobile

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
export function isImmobile(c: Character): boolean {
  return getAfflictions(c).includes('immobile')
}
