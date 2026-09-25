import type { Action, CombatState, DragAction, TriggeringAction, ExplosionAction, MoveAction } from '../types'
import { areReactionsComplete, getAction, getLiveReactionsTo, getReactionsTo, getRootOf } from '../rules/action'
import { opensExplosion } from '../rules/cast'
import { getOpportunityAction } from '../rules/attack'
import { getMoveAfter, getMoveBeforeBlast, type ReactionMove } from '../rules/reactionMoves'
import { getMoveFacts, getMoveOverride, getMoveWaypoint, getOpportunityAttacks } from '../rules/move'
import { withPlacements } from '../rules/board'
import { getDrawnOpportunityAttacks, isCancelled, isFlankInReach, isTriggeringAction } from '../rules/opportunity'
import { getStunEscapes } from '../rules/grapple'
import { makeAction } from '../factories'
import { appendActions, replaceActions } from './log'

// What follows a payment and a landing: the opportunity attacks an action
// drew, opened one at a time ahead of it, and the actions its reactions
// open once it has landed. Not commands of their own — the action commands
// call these to carry the fight on to its next step.

// combat.tex "Push and drag": the way pointed and answered, the attacks it
// drew from third parties are opened, one after another, before it lands.
// They were paid for by nobody yet: each opens a strike that is.
export function fightPush(state: CombatState, open: DragAction, newId: () => string): CombatState {
  if (!areReactionsComplete(state, open)) return state
  const live = getLiveReactionsTo(state, open.id)
  const fought = replaceActions(state, [{ ...open, fought: true }, ...live.map((r): Action => ({ ...r, status: 'resolved' }))])
  return advanceTriggering(fought, { ...open, fought: true }, newId)
}

// What follows the payment: a move, or an action that drew opportunity
// attacks, has the first of them opened before it resolves.
export function afterPaying(state: CombatState, id: string, newId: () => string): CombatState {
  const paid = getAction(state, id)
  if (paid?.kind === 'move') return advanceMove(state, paid, newId)
  return paid && isTriggeringAction(paid) ? advanceTriggering(state, paid, newId) : state
}

// combat.tex "Opportunity Attack": "The attack occurs before the effect of
// the triggering action" — each is spawned as its threatener's turn to
// swing comes up, exactly as a move's, but never halted early: nothing
// about the action keeps a later threatener from reaching its actor the way
// a mover outrunning a stretch of path does, so every reaction declared
// against it gets its attack (combat.tex "Flanking": "resolved in order").
// Once they are all fought, an explosion still going off has whoever's
// reflexes cleared it moving out of the way first.
function advanceTriggering(state: CombatState, root: TriggeringAction, newId: () => string): CombatState {
  const next = getDrawnOpportunityAttacks(state, root).find(({ spawned }) => spawned === null)
  if (next) return appendActions(state, [getOpportunityAction(state, next.reaction, newId())])
  if (root.kind === 'explosion' && !isCancelled(state, root)) return appendActions(state, escapesBefore(state, root, newId))
  return state
}

// combat.tex "Avoiding an Explosion": the escapes the reflexes that cleared
// the blast open, played out ahead of it; one whose test missed moves after
// it instead, opened when it has landed.
function escapesBefore(state: CombatState, root: ExplosionAction, newId: () => string): Action[] {
  return getReactionsTo(state, root.id).flatMap((reaction): Action[] => {
    const move = getMoveBeforeBlast(reaction)
    return move ? [openMove(reaction, newId, move)] : []
  })
}

// The move a reaction opens for its reactor.
function openMove(reaction: Action, newId: () => string, fields: ReactionMove): MoveAction {
  return makeAction('move', { ...fields, id: newId(), actorId: reaction.actorId, spawnedBy: reaction.id })
}

// combat.tex "Opportunity Attack": "The attack occurs before the effect of
// the triggering action." The mover is walked as far as one space short of
// the stretch the next opportunity attack fires on and the attack is opened
// as a strike of its own; once it lands the move is advanced again, to the
// next one or, if it interrupted, nowhere. One whose stretch the mover never
// reaches — a fall came first — opens nothing.
export function advanceMove(state: CombatState, move: MoveAction, newId: () => string): CombatState {
  if (getMoveOverride(state, move) !== null) return state
  const walked = getMoveFacts(state, move).path.length
  const next = getOpportunityAttacks(state, move).find(({ spawned }) => spawned === null)
  // a catch is fought where the runner already stands, so one on the last
  // step still comes (combat.tex "Catch")
  const catching = next?.reaction.grab && move.movement === 'run' ? 1 : 0
  if (!next || next.reaction.at! - catching > walked) return state
  const strike = getOpportunityAction(state, next.reaction, newId())
  const waypoint = getMoveWaypoint(state, move, next.reaction.at! - 1)
  const placed = waypoint ? withPlacements(state, { [move.actorId]: waypoint }) : state
  return appendActions(placed, [strike])
}

// combat.tex "Escape": each escape a stun opens, as a maneuver of the held
// one's that nobody may resist, for them to take or skip.
function escapesOnStun(state: CombatState, root: Action, newId: () => string): Action[] {
  return getStunEscapes(state, root).map(({ heldId, holderId }) =>
    makeAction('grapple', { maneuver: 'escape', unresisted: true, id: newId(), actorId: heldId, targetId: holderId, spawnedBy: root.id }))
}

// An opportunity attack fought against a mover or a triggering action, once
// it has landed, hands the root back: on to its next threatener, or to its end.
export function afterLanding(state: CombatState, resolved: Action, newId: () => string): CombatState {
  const reaction = resolved.spawnedBy ? getAction(state, resolved.spawnedBy) : null
  const root = reaction ? getRootOf(state, reaction) : null
  if (reaction?.kind !== 'opportunityAttack' || root?.status !== 'rolled') return state
  if (root.kind === 'move') return advanceMove(state, root, newId)
  return isTriggeringAction(root) ? advanceTriggering(state, root, newId) : state
}

// The actions the resolved one's reactions open, in the order they were
// declared: a flanker's opportunity attack, fought now the strike it answers
// has landed (any other root's were opened before it resolved — see
// `advanceMove`, `advanceTriggering` — and are not opened again here), and
// the moves a reaction grants once the root has landed. A cancelled action
// opens nothing. A cast that hit with an area to it opens that area as an
// explosion of the caster's, aimed and played out on its own (the caster's
// part is done).
export function spawn(state: CombatState, root: Action, newId: () => string): Action[] {
  if (isTriggeringAction(root) && root.cancelled) return []
  const opened = getReactionsTo(state, root.id).flatMap((reaction): Action[] => {
    if (reaction.kind === 'opportunityAttack') {
      return root.kind === 'strike' && isFlankInReach(state, reaction, root) ? [getOpportunityAction(state, reaction, newId())] : []
    }
    const move = getMoveAfter(state, root, reaction)
    return move ? [openMove(reaction, newId, move)] : []
  })
  opened.push(...escapesOnStun(state, root, newId))
  if (root.kind === 'cast' && opensExplosion(state, root)) {
    opened.push(makeAction('explosion', { id: newId(), actorId: root.actorId, source: 'cast', key: root.key, spawnedBy: root.id }))
  }
  return opened
}
