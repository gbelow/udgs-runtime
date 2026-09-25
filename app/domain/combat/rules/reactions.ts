import type { Action, ActionKind, CastAction, CombatState, DragAction, ExplosionAction, GrappleAction, MoveAction, PickUpAction, ShootAction, StrikeAction } from '../types'
import { getActionCost } from '../../character/rules/actionCosts'
import { ACTIONS, reactsTo } from '../actionCatalog'
import { getAdjacentIds, getDistanceBetween, getFlankers, getFootprint, getMeleeRange, getMeleeThreateners, getPlacedFootprint } from './board'
import { getThreatenedIds, isAvoidable } from './explosion'
import { getRunPath } from './move'
import { isTrampleable } from './trample'
import { getDragPath, getGrappleGroup } from './grapple'
import { sameCell, setDistance } from '../geometry'

// combat.tex "Reactions": "actions that can be performed on another
// character's turn but must be triggered by something." What an action,
// once committed to, triggers in everyone else: who may answer it, with
// which reaction, and — for a move — at which step of the path. The
// declaration is locked at the commit, so reading these off the action is
// the same as loading them then; the commands refuse any reaction not on
// the list.

export type Trigger = {
  characterId: string
  kind: ActionKind
  // the step of a move's path (counted from 1) at which the trigger fires;
  // null for a trigger that is not about a step
  at: number | null
  // who the reaction is against, when not the root's actor: the one a push
  // moves towards a third party
  against?: string
  // combat.tex "Catch": an opportunity to grab a runner and nothing else
  catchOnly?: boolean
}

export function getTriggers(state: CombatState, root: Action): Trigger[] {
  switch (root.kind) {
    case 'strike': return strikeTriggers(state, root)
    case 'shoot': return shootTriggers(state, root)
    case 'explosion': return explosionTriggers(state, root)
    case 'move': return moveTriggers(state, root)
    case 'cast': return castTriggers(state, root)
    case 'pickUp': return pickUpTriggers(state, root)
    case 'grapple':
    case 'drag': return grappleTriggers(state, root)
    default: return []
  }
}

export function getTriggersFor(state: CombatState, root: Action, characterId: string): Trigger[] {
  return getTriggers(state, root).filter((t) => t.characterId === characterId)
}

// combat.tex "Defend": the target may answer with any of the four defenses.
// combat.tex "Flanking": everyone flanking the attacker gets an opportunity
// attack.
function strikeTriggers(state: CombatState, root: StrikeAction): Trigger[] {
  if (!root.targetId) return []
  const defenses = (Object.keys(ACTIONS) as ActionKind[])
    .filter((kind) => ACTIONS[kind].type === 'reaction' && kind !== 'opportunityAttack' && reactsTo(kind, 'strike'))
    .map((kind): Trigger => ({ characterId: root.targetId!, kind, at: null }))
  const flankers = getFlankers(state, root.actorId, root.targetId)
    .filter((id) => getMeleeRange(state.characters[id]) > 0)
    .map((id): Trigger => ({ characterId: id, kind: 'opportunityAttack', at: null }))
  return [...defenses, ...flankers]
}

// combat.tex "Opportunity Attack": a triggering action is answered by
// anyone who threatens the one attempting it with a melee weapon.
function opportunityTriggers(state: CombatState, actorId: string): Trigger[] {
  return getMeleeThreateners(state, actorId).map((id): Trigger => ({ characterId: id, kind: 'opportunityAttack', at: null }))
}

// combat.tex "Reflex": the target may answer a shot with evasion or guard.
// combat.tex "Guard": someone may "block ranged attacks against ...
// adjacent characters, as long as they are closer to the projectile source
// than the adjacent character". What they may guard with is the option's
// to say, as it is for the target.
function shootTriggers(state: CombatState, root: ShootAction): Trigger[] {
  if (!root.targetId) return []
  const own = (Object.keys(ACTIONS) as ActionKind[])
    .filter((kind) => ACTIONS[kind].type === 'reaction' && reactsTo(kind, 'shoot'))
    .map((kind): Trigger => ({ characterId: root.targetId!, kind, at: null }))
  const toTarget = getDistanceBetween(state, root.actorId, root.targetId)
  const guards = getAdjacentIds(state, root.targetId)
    .filter((id) => id !== root.actorId)
    .filter((id) => {
      const toGuard = getDistanceBetween(state, root.actorId, id)
      return toGuard !== null && toTarget !== null && toGuard < toTarget
    })
    .map((id): Trigger => ({ characterId: id, kind: 'guard', at: null }))
  // combat.tex "Opportunity Attack": "Triggering actions include ... ranged
  // attacks"
  return [...own, ...guards, ...opportunityTriggers(state, root.actorId)]
}

// combat.tex "Grapple Maneuvers": the partner may pay to resist — except
// an escape "Being stunned allows for", "without the possibility of active
// resistance". "Push and drag": everyone dragged along answers it — resists,
// helps, goes along, or lets go — while committed; once its way is pointed,
// the third parties it moves someone towards do.
// combat.tex "Opportunity Attack": "standing up in melee range" triggers
// one, an escape made to stand up as much as any — from the partner too,
// who then answers with it instead of resisting (the table's ruling).
function grappleTriggers(state: CombatState, root: GrappleAction | DragAction): Trigger[] {
  if (root.kind === 'grapple') {
    const resist: Trigger[] = root.targetId && !root.unresisted ? [{ characterId: root.targetId, kind: 'resist', at: null }] : []
    return root.stand ? [...resist, ...opportunityTriggers(state, root.actorId)] : resist
  }
  if (root.status !== 'committed') return root.status === 'rolled' && !root.fought ? pushTriggers(state, root) : []
  return getGrappleGroup(state.grapples, root.actorId)
    .filter((id) => id !== root.actorId)
    .flatMap((id) => (['resist', 'assist', 'carry', 'letGo'] as const).map((kind): Trigger => ({ characterId: id, kind, at: null })))
}

// combat.tex "Opportunity Attack": "moving towards a melee weapon while
// within its attack range" — a push moves everyone dragged, and a third
// party gets the attack against the first of them it moves closer from
// within range, at that step, on the way the winner pointed.
function pushTriggers(state: CombatState, root: DragAction): Trigger[] {
  const path = getDragPath(state, root)
  if (!path || path.steps.length === 0) return []
  const movers = Object.keys(path.steps[0])
  const start = (id: string) => state.board?.placements[id]
  const triggers: Trigger[] = []
  for (const id of Object.keys(state.characters)) {
    const other = getPlacedFootprint(state, id)
    const range = getMeleeRange(state.characters[id])
    if (movers.includes(id) || !other || range === 0) continue
    const hit = movers.flatMap((m) => {
      const c = state.characters[m]
      const from = start(m)
      if (!c || !from) return []
      const distances = [from, ...path.steps.map((step) => step[m])].map((p) => setDistance(getFootprint(c, p), other))
      const at = firstStep(distances, (previous, now) => previous <= range && now < previous)
      return at === null ? [] : [{ at, against: m }]
    }).sort((a, b) => a.at - b.at)[0]
    if (hit) triggers.push({ characterId: id, kind: 'opportunityAttack', ...hit })
  }
  return triggers
}

// combat.tex "Explosions": "defended against with a reflex test"; "Sprays":
// "target all characters in range, which their reflex saves to escape".
// Everyone the explosion as declared may reach — a spray not yet aimed
// threatens its whole range — may avoid it, the one who set it off as much
// as anyone: a bomb is no respecter of the hand that threw it, and whoever
// stands in the area is a target of it.
// combat.tex "Opportunity Attack": a thrown one is a ranged attack, and
// draws what any does.
function explosionTriggers(state: CombatState, root: ExplosionAction): Trigger[] {
  const opportunity = root.source === 'thrown' ? opportunityTriggers(state, root.actorId) : []
  if (!isAvoidable(root)) return opportunity
  return [...getThreatenedIds(state, root).map((id): Trigger => ({ characterId: id, kind: 'avoidExplosion', at: null })), ...opportunity]
}

// combat.tex "Opportunity Attack": "Triggering actions include casting
// spells"; spells.tex "Quicken Spell": "not cause oportunity attacks" — the
// one way to cast without drawing one.
function castTriggers(state: CombatState, root: CastAction): Trigger[] {
  return root.quicken ? [] : opportunityTriggers(state, root.actorId)
}

// combat.tex "Opportunity Attack": "Triggering actions include ... standard
// actions of 3 AP or more" — picking up is one (combat.tex "Standard
// Action"), cheaper with Prestidigitation.
function pickUpTriggers(state: CombatState, root: PickUpAction): Trigger[] {
  const actor = state.characters[root.actorId]
  return actor && getActionCost(actor, 'standardAction').AP >= 3 ? opportunityTriggers(state, root.actorId) : []
}

// combat.tex "Opportunity Attack": triggered by "moving towards a melee
// weapon while within its attack range" — the first step taken from a cell
// already within someone's melee range to one closer to them. Stepping into
// range is not yet moving towards the weapon while within it.
// combat.tex "Follow": "as a reaction to any movement except running,
// follow another character who is already within melee range."
// combat.tex "Opportunity Attack": "standing up in melee range" is a
// triggering action; the attack is fought before the mover is up, at step 0.
// Going prone triggers nothing.
function moveTriggers(state: CombatState, root: MoveAction): Trigger[] {
  if (root.movement === 'prone') return []
  if (root.movement === 'stand') return opportunityTriggers(state, root.actorId).map((t) => ({ ...t, at: 0 }))
  const mover = state.characters[root.actorId]
  const from = state.board?.placements[root.actorId]
  if (!mover || !from || !state.board) return []
  const path = getRunPath(state, root)
  const triggers: Trigger[] = []
  for (const id of Object.keys(state.characters)) {
    if (id === root.actorId) continue
    const other = getPlacedFootprint(state, id)
    if (!other) continue
    // combat.tex "Movement" — "trample": whoever the path comes into gets
    // trampled unless they get out of the way — "Evade: ... This can be used
    // to avoid being trampled". "Trampling a prone character is an automatic
    // success and allows free passage": nothing to evade.
    if (isTrampleable(state, id) && path.some((cell) => getFootprint(mover, { ...from, cell }).some((f) => other.some((o) => sameCell(f, o))))) {
      triggers.push({ characterId: id, kind: 'evade', at: null })
    }
    const distances = [from, ...path.map((cell) => ({ ...from, cell }))].map((p) => setDistance(getFootprint(mover, p), other))
    const range = getMeleeRange(state.characters[id])
    if (range > 0 && distances[0] <= range && root.movement !== 'run') triggers.push({ characterId: id, kind: 'follow', at: null })
    if (range === 0) continue
    const approach = firstStep(distances, (previous, now) => previous <= range && now < previous)
    if (approach !== null) triggers.push({ characterId: id, kind: 'opportunityAttack', at: approach })
    // combat.tex "Catch": "someone tries to initiate a grapple against a
    // running target" — one with a grapple row may grab a runner once the
    // run has brought them within its reach, as nobody else may; fought, as
    // every attack on a mover is, with the mover stood where the step before
    // `at` left them — here, the first step in reach
    const grab = root.movement === 'run' ? Math.max(getMeleeRange(state.characters[id], 'grapple I'), getMeleeRange(state.characters[id], 'grapple II')) : 0
    if (grab > 0) {
      const inReach = distances.slice(1).findIndex((d) => d <= grab)
      if (inReach >= 0 && !triggers.some((t) => t.characterId === id && t.at === inReach + 2)) triggers.push({ characterId: id, kind: 'opportunityAttack', at: inReach + 2, catchOnly: true })
    }
    // combat.tex "Hook Attack": "a reaction against running targets that
    // move away from the weapon within two spaces, which are both inside its
    // melee range"
    const hook = getMeleeRange(state.characters[id], 'hook')
    if (root.movement !== 'run' || hook === 0) continue
    const away = firstStep(distances, (previous, now) => now > previous && now <= hook)
    if (away !== null) triggers.push({ characterId: id, kind: 'opportunityAttack', at: away })
  }
  return triggers
}

// the first step, counted from 1, at which `moved` holds between the
// distance before it and the distance after it; `distances` starts with the
// one before the first step
function firstStep(distances: number[], moved: (previous: number, now: number) => boolean): number | null {
  for (let i = 1; i < distances.length; i++) if (moved(distances[i - 1], distances[i])) return i
  return null
}
