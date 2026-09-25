import type { AttackKind, CampaignCharacter, Character, WeaponAttack } from '../../types'
import { ActionSchema, type Action, type ActionOf, type AttackAction, type CombatState, type OpportunityAction, type StrikeAction, type WeaponAction } from '../types'
import { LOCATIONS, QUICKEN_DL } from '../../tables'
import { SPELLS, isSpellKey } from '../../spells'
import { AttackVariant, getAttacksList, getShotKind, needsFocus } from '../../character/rules/gear'
import { getAccuracy, getDefend, getGrapple, getReflex, getSD, getStrike } from '../../character/rules/skills'
import { getAGI } from '../../character/rules/characteristics'
import { getBuffBonus } from '../../character/rules/effects'
import { Term, sumTerms } from '../../character/rules/terms'
import { getAttackKind, hasProperty } from '../../weaponProperties'
import { isHighGround } from './board'
import { getBalanceDL, getBalanceTestTerms, getMoveWaypoint, getStepDelta, isHookedRunner } from './move'
import type { Test } from './test'
import { getExplosionDLTerms } from './explosion'
import { getDragPath, getGrappleStrikeTerm, getManeuverDLTerms } from './grapple'
import { findWeaponRow, getWeaponRows, isRowUsable, type WeaponRow } from './weaponRow'
import { getReactionsTo, getRootOf } from './action'
import { getCastTerms } from './cast'

// What an action is rolled with and against: the weapon rows and
// variations an attack can be made with, the opportunity attack a reaction
// opens, the terms of each side of the test, and the test itself.

// ---------------------------------------------------------------------------
// Weapon rows named by an action

// gear.tex "Explosion": a row that "resolves like an explosion" — it has
// the property. Whether it has anything to go off with is the charge's.
function explodes(atk: WeaponAttack): boolean {
  return hasProperty(atk.properties, 'explosion')
}

// The kind of weapon row each action is made with: a strike a melee row
// (combat.tex "Strike"), a shot a shooting or a throwing one (combat.tex
// "Accuracy": "a throw or shot directed at a target"), an
// explosion any ranged row that explodes (combat.tex "Explosions": "If the
// explosion comes from a projectile") — and a row that explodes is fired as
// nothing else.
function rowFits(atk: WeaponAttack, kind: WeaponAction['kind']): boolean {
  const rowKind: AttackKind = getAttackKind(atk.range)
  switch (kind) {
    case 'strike': return rowKind === 'melee'
    case 'shoot': return rowKind !== 'melee' && !explodes(atk)
    case 'explosion': return rowKind !== 'melee' && explodes(atk)
  }
}

// The variation an attack declared, priced against the attacker as they
// stand; null while it names no row of the attack's kind the attacker can
// fire. combat.tex "Focus surge": "required to use ranged attacks".
export function getAttackVariant(c: Character, action: WeaponAction): AttackVariant | null {
  const row = findWeaponRow(c, action.weaponKey, action.attack)
  if (!row || !isRowUsable(c, row) || !rowFits(row.atk, action.kind)) return null
  if (action.kind !== 'strike' && needsFocus(row.atk, c)) return null
  return getAttacksList({ atk: row.atk, weapon: row.weapon })(c).find((v) => v.name === action.variant) ?? null
}

// The strike an opportunity attack opens, as declared on the reaction:
// committed already, since the reaction was, and aimed at whoever it
// answers — a catch, when it is a grab at a runner (combat.tex "Catch").
export function getOpportunityStrike(state: CombatState, reaction: ActionOf<'opportunityAttack'>, id: string): StrikeAction {
  const { weaponKey, attack, variant, location, grab } = reaction
  const root = getRootOf(state, reaction)
  const caught = grab && root?.kind === 'move' && root.movement === 'run' && root.actorId === reaction.targetId
  return ActionSchema.parse({ kind: 'strike', id, actorId: reaction.actorId, targetId: reaction.targetId, weaponKey, attack, variant, location, grab, catch: caught, opportunity: true, spawnedBy: reaction.id, status: 'committed' }) as StrikeAction
}

// What the opportunity attack opens, as declared on the reaction: a strike,
// or against a grapple partner the maneuver or the push it was declared as
// (combat.tex "Grapple Maneuvers", "Push and drag": "can be used like
// opportunity attacks").
export function getOpportunityAction(state: CombatState, reaction: ActionOf<'opportunityAttack'>, id: string): OpportunityAction {
  const base = { id, actorId: reaction.actorId, targetId: reaction.targetId, opportunity: true, spawnedBy: reaction.id, status: 'committed' }
  if (reaction.mode === 'grapple') return ActionSchema.parse({ ...base, kind: 'grapple', maneuver: reaction.maneuver }) as OpportunityAction
  if (reaction.mode === 'drag') return ActionSchema.parse({ ...base, kind: 'drag' }) as OpportunityAction
  return getOpportunityStrike(state, reaction, id)
}

// The fight as it will stand when the opportunity attack is fought: against
// a move, with the mover walked one space short of the stretch that fired
// it; against a push, with everyone dragged pushed as far. Reach is judged
// from there.
export function getOpportunityState(state: CombatState, reaction: ActionOf<'opportunityAttack'>): CombatState {
  const root = getRootOf(state, reaction)
  if (root?.kind === 'drag' && reaction.at !== null && reaction.at > 1 && state.board) {
    const before = getDragPath(state, root)?.steps[reaction.at - 2]
    return before ? { ...state, board: { ...state.board, placements: { ...state.board.placements, ...before } } } : state
  }
  if (root?.kind !== 'move' || reaction.at === null || !state.board) return state
  const waypoint = getMoveWaypoint(state, root, reaction.at - 1)
  return waypoint ? { ...state, board: { ...state.board, placements: { ...state.board.placements, [root.actorId]: waypoint } } } : state
}

// Whether the strike may be declared as this variation where it is made.
// combat.tex "Braced Attack": "a reaction when a target is moving towards
// the weapon or as an action in situations where the attacker is mounted
// and running" — mounts are not modelled, so only the reaction, drawn by a
// step towards the attacker. "Hook Attack": "an action or ... a reaction
// against running targets that move away from the weapon" — and the
// reaction a runner moving away draws is only ever a hook attack.
export function isVariantOpen(state: CombatState, action: Action, variant: string): boolean {
  if (action.kind === 'strike') return action.opportunity || variant !== 'braced'
  if (action.kind !== 'opportunityAttack') return true
  const root = getRootOf(state, action)
  const step = root?.kind === 'move' && action.at !== null ? { move: root, at: action.at } : null
  const away = step !== null && isHookedRunner(state, step.move, step.at, action.actorId)
  if (variant === 'braced') return step !== null && (getStepDelta(state, step.move, step.at, action.actorId) ?? 0) < 0
  if (variant === 'hook') return away
  return !away
}

// Every attack of the kind the character could declare: each usable row of
// that kind of each wielded weapon, at each of its variations. The panel
// renders these as-is.
export type AttackOption = {
  weaponKey: string
  weapon: string
  attack: string
  variant: string
  AP: number
  STA: number
  penalty: number
  blunt: number
  cut: number
  // metres, for a shot; null for a strike
  reach: number | null
}

export function getAttackOptions(c: Character, kind: WeaponAction['kind']): AttackOption[] {
  return getWeaponRows(c).flatMap((row) => {
    if (!isRowUsable(c, row) || !rowFits(row.atk, kind)) return []
    if (kind !== 'strike' && needsFocus(row.atk, c)) return []
    return getAttacksList({ atk: row.atk, weapon: row.weapon })(c).map((v) => ({
      weaponKey: row.wielded.key,
      weapon: row.weapon.name,
      attack: row.atk.name,
      variant: v.name,
      AP: v.AP,
      STA: v.STA,
      penalty: v.penalty,
      blunt: v.blunt,
      cut: v.cut,
      reach: v.reach,
    }))
  })
}

// combat.tex "Focus surge": "required to use ranged attacks" — whether the
// character holds a row of the kind that only the surge is keeping closed.
export function hasUnfocusedRow(c: CampaignCharacter, kind: WeaponAction['kind']): boolean {
  return getWeaponRows(c).some((row) => isRowUsable(c, row) && rowFits(row.atk, kind) && needsFocus(row.atk, c))
}

// ---------------------------------------------------------------------------
// The test

// combat.tex "Strike": strike, less the variation's penalty (combat.tex
// "Heavy Attack") and the location's (combat.tex "Localized damage").
// combat.tex "Accuracy": a shot is the Accuracy test instead, and the way of
// shooting may carry a bonus of its own (abilities.tex "Elite Sniper":
// "Snipe gets +1|2|3 to hit").
// combat.tex "Attack and Defend": a grapple row "can use the grapple skill
// instead of strike to attack during a grapple".
export function getAttackTerms(state: CombatState, action: AttackAction): Term[] {
  const c = state.characters[action.actorId]
  if (!c) return []
  const variant = getAttackVariant(c, action)
  const shot = action.kind === 'shoot' ? getShotKind(action.variant) : null
  const grapple = action.kind === 'strike' ? getGrappleStrikeTerm(state, action) : null
  const strike = { label: 'strike', value: getStrike(c) }
  return [
    action.kind === 'strike' ? (grapple && grapple.value > strike.value ? grapple : strike) : { label: 'accuracy', value: getAccuracy(c) },
    { label: action.variant || 'variant', value: -(variant?.penalty ?? 0) },
    ...(shot ? [{ label: 'abilities', value: getBuffBonus(c, `hit:${shot}`) }] : []),
    { label: action.location, value: -LOCATIONS[action.location].penalty },
  ]
}

// combat.tex "Avoiding an Explosion": "make a reflex skill test against the
// DL of the explosion" — what a reaction that is a test of its own is
// rolled with.
export function getReactionTestTerms(state: CombatState, reaction: Action): Term[] {
  const reactor = state.characters[reaction.actorId]
  if (!reactor || reaction.kind !== 'avoidExplosion') return []
  return [{ label: 'reflex', value: getReflex(reactor) }]
}

// combat.tex "Reflex": what one reaction to a shot puts up against it — the
// reactor's reflexes (combat.tex "Accuracy": "against the opponent's
// reflexes"), and for a guard the shield's cover ("Guard": "Shield Cover is
// added to guard as a bonus").
function shotDefenseTerms(state: CombatState, reaction: Action): Term[] {
  const reactor = state.characters[reaction.actorId]
  if (!reactor) return []
  const terms: Term[] = [{ label: 'reflex', value: getReflex(reactor) }]
  if (reaction.kind === 'guard') {
    const row = findWeaponRow(reactor, reaction.weaponKey, reaction.attack)
    if (row?.weapon.shield) terms.push({ label: 'cover', value: row.weapon.shield.cover })
  }
  return terms
}

// The reaction a shot is met with: the target's own, or a guard made for
// them by someone adjacent (combat.tex "Guard": "block ranged attacks
// against themselves or adjacent characters"). A shot has to beat every one
// of them (the table's ruling), so the one it is scored against — and the
// one whose defense the damage meets — is whichever puts up the most.
export function getShotDefense(state: CombatState, root: Action): Action | null {
  return getReactionsTo(state, root.id)
    .filter((r) => r.kind === 'evasion' || r.kind === 'guard')
    .reduce<Action | null>((best, r) => (best === null || sumTerms(shotDefenseTerms(state, r)) > sumTerms(shotDefenseTerms(state, best)) ? r : best), null)
}

// combat.tex "Defend": the DL a strike is scored against is the defender's
// Defend if they react, "otherwise, they use the SD" (creating.tex "Standard
// Deflection"). An evasive jump "gives +AGI/2 on the skill test"; "Blocking
// with a shield adds its cover to defend".
// combat.tex "High Ground": "Both receive a +2 bonus to their melee defense
// against each other" — on the SD as much as on an active defense.
// combat.tex "Accuracy": a shot is scored "against the opponent's reflexes
// or their SD, should they choose not to react"; "Guard": "Shield Cover is
// added to guard as a bonus", the guard's own reflexes when it is an ally's.
// spells.tex "Casting spells": the DL is the spell's own; "Quicken Spell:
// Increases spell DL by 4".
export function getDLTerms(state: CombatState, root: Action): Term[] {
  if (root.kind === 'explosion') return getExplosionDLTerms(state, root)
  if (root.kind === 'grapple') return getManeuverDLTerms(state, root)
  if (root.kind === 'drag' || root.kind === 'release' || root.kind === 'holdBack' || root.kind === 'pickUp') return []
  if (root.kind === 'cast') {
    if (!isSpellKey(root.key)) return []
    return [{ label: 'spell DL', value: SPELLS[root.key].DL ?? 0 }, ...(root.quicken ? [{ label: 'quicken', value: QUICKEN_DL }] : [])]
  }
  const defender = root.targetId ? state.characters[root.targetId] : undefined
  if (!defender) return []
  if (root.kind === 'shoot') {
    const reaction = getShotDefense(state, root)
    return reaction ? shotDefenseTerms(state, reaction) : [{ label: 'SD', value: getSD(defender) }]
  }
  const reaction = getReactionsTo(state, root.id).find((r) => r.actorId === defender.id)
  const terms: Term[] = !reaction ? [{ label: 'SD', value: getSD(defender) }] : [{ label: 'defend', value: getDefend(defender) }]
  if (reaction?.kind === 'evasiveJump') terms.push({ label: 'jump', value: Math.floor(getAGI(defender) / 2) })
  if (reaction?.kind === 'block') {
    const row = findWeaponRow(defender, reaction.weaponKey, reaction.attack)
    if (row?.weapon.shield) terms.push({ label: 'cover', value: row.weapon.shield.cover })
  }
  if (root.kind === 'strike' && isHighGround(state, root.actorId, defender.id)) terms.push({ label: 'high ground', value: 2 })
  // combat.tex "Opportunity Attack": "the defense takes -2 penalty unless
  // it's the SD" — not against a braced attack (the table's ruling)
  if (root.kind === 'strike' && root.opportunity && root.variant !== 'braced' && reaction) terms.push({ label: 'opportunity', value: -2 })
  return terms
}

export function getDL(state: CombatState, root: Action): number {
  return sumTerms(getDLTerms(state, root))
}

// The score and DL of the test a committed root is closed by, each broken
// down into its terms, or null when it has none of its own. A strike or a
// shot against the target's defense; a move across difficult terrain a
// Balance test against the ground (combat.tex "Balance"); a cast against the
// spell's DL.
// combat.tex "Grapple Maneuvers": the grapple skill against the partner's.
export function getRootTestTerms(state: CombatState, root: Action): { skill: Term[]; DL: Term[] } | null {
  const actor = state.characters[root.actorId]
  if (!actor) return null
  switch (root.kind) {
    case 'strike':
    case 'shoot':
      return { skill: getAttackTerms(state, root), DL: getDLTerms(state, root) }
    case 'grapple':
      return { skill: getManeuverTerms(actor), DL: getDLTerms(state, root) }
    case 'move':
      return { skill: getBalanceTestTerms(actor), DL: [{ label: 'terrain', value: getBalanceDL(state, root) }] }
    case 'cast':
      return { skill: getCastTerms(actor, root), DL: getDLTerms(state, root) }
    default:
      return null
  }
}

// The root's test, on its scale: a strike or a shot trades the critical for
// HOP (play.tex "Hit Overflow Point"), as a cast does, its overflow the HOP
// that buy improvements, and a graze left open to be saved unless it was
// quickened (spells.tex "Casting spells"; "Quicken Spell": "Grazes equal
// misses"). A maneuver is read on the four degrees (combat.tex "Grapple
// Maneuvers": "on a critical", "on a hit"), as a Balance test is.
export function getRootTest(state: CombatState, root: Action): Test | null {
  const actor = state.characters[root.actorId]
  const terms = getRootTestTerms(state, root)
  if (!actor || !terms) return null
  const base = { skill: sumTerms(terms.skill), DL: sumTerms(terms.DL), explodes: false }
  switch (root.kind) {
    case 'strike':
    case 'shoot':
      return { ...base, scale: 'overflow', grazes: !isPiercingAttack(actor, root) }
    case 'cast':
      return { ...base, scale: 'overflow', grazes: !root.quicken }
    default:
      return { ...base, scale: 'degrees' }
  }
}

export function getManeuverTerms(c: Character): Term[] {
  return [{ label: 'grapple', value: getGrapple(c) }]
}

// A reaction that is a test of its own, scored against the root's DL.
export function getReactionTest(state: CombatState, root: Action, reaction: Action): Test {
  return { skill: sumTerms(getReactionTestTerms(state, reaction)), DL: getDL(state, root), explodes: false, scale: 'degrees' }
}

export function isPiercingAttack(c: Character, action: AttackAction): boolean {
  const row = findWeaponRow(c, action.weaponKey, action.attack)
  return row ? hasProperty(row.atk.properties, 'piercing') : false
}

// gear.tex "DEF": only a row with the property can block or intercept.
export function defRows(c: Character): WeaponRow[] {
  return getWeaponRows(c).filter((row) => hasProperty(row.atk.properties, 'DEF') && isRowUsable(c, row))
}

// combat.tex "Guard": "If using a shield"; gear.tex "Slow, Fast": a fast
// projectile "can only be blocked with a shield", a slow one may be guarded
// with any DEF row (the table's ruling). What the shot was fired with says
// which; nothing declared, a shield.
export function guardRows(state: CombatState, c: Character, root: Action): WeaponRow[] {
  const shooter = state.characters[root.actorId]
  const shot = root.kind === 'shoot' && shooter ? findWeaponRow(shooter, root.weaponKey, root.attack) : null
  const slow = shot !== null && hasProperty(shot.atk.properties, 'slow')
  return defRows(c).filter((row) => slow || row.weapon.shield !== undefined)
}
