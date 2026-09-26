import type { Character, WeaponAttack } from '../../types'
import type { Action, CombatState, Deliveries, Grapple, GrappleAction, GrappleFacts, GrappleManeuver, HoldBackAction, ReleaseAction, StrikeAction } from '../types'
import { GRAPPLE_AFFLICTIONS } from '../../lists'
import { getStrikeDamage } from '../../character/rules/gear'
import { hasAffliction } from '../../character/rules/afflictions'
import { getGrapple } from '../../character/rules/skills'
import { Term } from '../../character/rules/terms'
import { hasProperty } from '../../weaponProperties'
import { getReactionsTo } from './log'
import { findGrapple, getGrapplesOf, isInGrapple, getPartner, holds } from './partners'
import { findWeaponRow, getWeaponRows, isRowUsable, type WeaponRow } from './weaponRow'
import { delivering, getRowDamage } from './delivery'
import { isAttackAction } from './actionCatalog'

type GrappleAffliction = (typeof GRAPPLE_AFFLICTIONS)[number]

// ---------------------------------------------------------------------------
// Grapple rows

// gear.tex "Grapple I/II": "This attack is used for grappling actions."
export function isGrappleRow(atk: WeaponAttack): boolean {
  return hasProperty(atk.properties, 'grapple I') || hasProperty(atk.properties, 'grapple II')
}

// Every grapple row the character can use right now, as they hold it — a
// Bardiche's shaft only in both hands, a free hand among them (gear.tex
// "Unarmed") — grapple II first: it is the one that deals damage (gear.tex
// "Grapple II deals damage normally").
export function getGrappleRows(c: Character): WeaponRow[] {
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
  return isInGrapple(state, c.id) && hasAffliction(c, 'prone')
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

// What a disarm can go for: the id of anything in the partner's hands — a
// natural weapon is not an item and cannot be taken.
export function getDisarmOptions(state: CombatState, root: GrappleAction): string[] {
  const target = root.targetId ? state.characters[root.targetId] : undefined
  return target ? target.held.map((i) => i.id) : []
}

// combat.tex "Grapple Maneuvers": a maneuver does something on a hit or a
// critical; "If a grapple maneuvre grazes or misses, it simply has no
// effect."
export function isManeuverWon(root: GrappleAction): boolean {
  return root.roll?.degree === 'hit' || root.roll?.degree === 'critical'
}

// Whether a rolled maneuver's hit or critical still waits on the attacker's
// pick of what a disarm takes.
export function needsDisarmPick(state: CombatState, root: GrappleAction): boolean {
  return root.maneuver === 'disarm' && isManeuverWon(root) && root.item === '' && getDisarmOptions(state, root).length > 0
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
  return done && isManeuverWon(root) ? freeSeized(state, root.actorId, done) : done
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
  const pair: [string, string] = [root.actorId, root.targetId]
  const found = findGrapple(state.grapples, root.actorId, root.targetId)
  if (!found && root.hook) return getHookKnockdownFacts(state, root, pair)
  if (!found) return null
  const g = found
  const deliveries = getHoldDeliveries(state, g)
  const degree = root.roll.degree
  const critical = degree === 'critical'
  const landed = isManeuverWon(root)
  const along = critical || (degree === 'hit' && root.along && !root.hook)
  const who = critical ? [root.targetId] : [root.targetId, root.actorId]
  switch (root.maneuver) {
    case 'escape':
      if (root.stand) return facts(state, pair, g, { deliveries, stand: landed ? [root.actorId] : [] })
      return facts(state, pair, landed ? null : g, { deliveries })
    case 'knockdown': {
      const actor = state.characters[root.actorId]
      if (degree === 'hit' && actor && hasAffliction(actor, 'prone')) return facts(state, pair, g, { deliveries, prone: [root.targetId] })
      return facts(state, pair, g, { deliveries, prone: along ? who : [] })
    }
    case 'immobilize':
      return facts(state, pair, along ? { ...g, immobile: [...new Set([...g.immobile, ...who])] } : g, { deliveries })
    case 'disarm': {
      const item = root.item && getDisarmOptions(state, root).includes(root.item) ? root.item : null
      if (!item || !landed) return facts(state, pair, g, { deliveries })
      if (critical) return facts(state, pair, g, { deliveries, dropped: { ownerId: root.targetId, itemId: item } })
      return facts(state, pair, { ...g, seized: [...new Set([...g.seized, item])] }, { deliveries, seized: item })
    }
  }
}

// combat.tex "Hook Attack": the knockdown a hook opens between two who hold
// nothing of each other — no grapple to change, nor holds to deal their
// damage; the target falls on a critical ("Knockdown": "It is not possible
// to throw oneself along during a hook attack").
function getHookKnockdownFacts(state: CombatState, root: GrappleAction, pair: [string, string]): GrappleFacts {
  return { pair, grapple: null, prone: root.roll?.degree === 'critical' ? [pair[1]] : [], stand: [], dropped: null, seized: null, freed: [], on: {}, off: {}, deliveries: {} }
}

// Whether the knockdown the strike's hook opened put the character down.
export function isKnockedDownByHook(state: CombatState, strike: StrikeAction, id: string): boolean {
  return state.actions.some((a) => a.kind === 'grapple' && a.hook && a.spawnedBy === strike.id && a.step === 'done' && (a.facts?.prone.includes(id) ?? false))
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
