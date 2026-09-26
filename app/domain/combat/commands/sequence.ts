import type { Action, CombatState, DragAction, ExplosionAction, MoveAction } from '../types'
import { areReactionsComplete } from '../rules/action'
import { getLiveReactionsTo, getOpenAction, getReactionsTo } from '../rules/log'
import { opensExplosion } from '../rules/cast'
import { getOpportunityAction, getOpportunityState, getOpportunityStop, isOpportunityReached } from '../rules/attack'
import { getMoveAfter, getMoveBeforeBlast, type ReactionMove } from '../rules/reactionMoves'
import { getDrawnOpportunityAttacks, isCancelled, isFlankInReach, isTriggeringAction, isVoided } from '../rules/opportunity'
import { getDragSides, getStunEscapes } from '../rules/grapple'
import { makeAction } from '../factories'
import { appendActions, replaceActions } from './log'

// What carries the fight on between the commands. Every action runs
// define → react → roll → post → effect; the actions its reactions open are
// played out between its roll and its effect, and the follow-ups its effect
// generates after it. Each is pushed onto the stack over the action that
// opened it, so the top is always the one the table is waiting on, and when
// it lands the action beneath picks up where it was. Not commands of their
// own — the action commands call these after every change.

// Carries the fight on from whatever is on top of the stack: a rolled action
// opens the next of the actions its reactions opened before its effect. One
// waiting on a declaration, an answer or a choice is left to it.
export function advance(state: CombatState, newId: () => string): CombatState {
  const top = getOpenAction(state)
  return top?.step === 'post' ? openBefore(state, top, newId) : state
}

// combat.tex "Opportunity Attack": "The attack occurs before the effect of
// the triggering action." The attacks a move, a strike or a triggering
// action drew are opened one at a time in the order it comes to them, each
// once the one before has landed; a move or a push has everyone it carries
// stood one space short of the stretch the next one fires on while it is
// fought. The run ends once the root is brought to a stop, or at an attack
// on a stretch it never reaches; a flanker the attacker has got out of
// range of is passed over (combat.tex "Flanking"). Once every attack is
// fought, an explosion still going off has whoever's reflexes cleared it
// moving out of the way first.
function openBefore(state: CombatState, root: Action, newId: () => string): CombatState {
  if (root.kind !== 'move' && root.kind !== 'strike' && !isTriggeringAction(root)) return state
  if (getOpportunityStop(state, root) !== null) return state
  const next = getDrawnOpportunityAttacks(state, root)
    .find(({ reaction, spawned }) => spawned === null && (root.kind !== 'strike' || isFlankInReach(state, reaction, root)))
  if (next) {
    if (!isOpportunityReached(state, root, next.reaction)) return state
    const placed = getOpportunityState(state, next.reaction)
    return appendActions(placed, [getOpportunityAction(placed, next.reaction, newId())])
  }
  if (root.kind === 'explosion' && !isCancelled(state, root)) return appendActions(state, escapesBefore(state, root, newId))
  return state
}

// combat.tex "Avoiding an Explosion": the escapes the reflexes that cleared
// the blast open, played out ahead of it, each once; one whose test missed
// moves after it instead, opened when it has landed.
function escapesBefore(state: CombatState, root: ExplosionAction, newId: () => string): Action[] {
  return getReactionsTo(state, root.id).flatMap((reaction): Action[] => {
    const move = getMoveBeforeBlast(reaction)
    const opened = state.actions.some((a) => a.spawnedBy === reaction.id)
    return move && !opened ? [openMove(reaction, newId, move)] : []
  })
}

// The move a reaction opens for its reactor.
function openMove(reaction: Action, newId: () => string, fields: ReactionMove): MoveAction {
  return makeAction('move', { ...fields, id: newId(), actorId: reaction.actorId, spawnedBy: reaction.id })
}

// combat.tex "Push and drag": the way pointed and answered, the attacks it
// drew from third parties are opened, one after another, before it lands,
// with everyone it moves setting out from where they stand now. They were
// paid for by nobody yet: each opens a strike that is.
export function fightPush(state: CombatState, open: DragAction, newId: () => string): CombatState {
  if (!areReactionsComplete(state, open)) return state
  const live = getLiveReactionsTo(state, open.id)
  const from = Object.fromEntries(getDragSides(state, open).movers.flatMap((id) => {
    const placement = state.board?.placements[id]
    return placement ? [[id, placement]] : []
  }))
  const fought: DragAction = { ...open, fought: true, from }
  return advance(replaceActions(state, [fought, ...live.map((r): Action => ({ ...r, step: 'done' }))]), newId)
}

// The follow-ups the landed action generates, in the order they were
// declared: the moves its reactions grant once it has landed, the escapes a
// stun opens, and the explosion a cast that hit with an area to it goes off
// as, aimed and played out on its own (the caster's part is done). Its
// opportunity attacks were opened before it landed (`openBefore`). A voided
// action generates nothing (the table's ruling: no follow-ups for an
// interrupted action).
export function getFollowUps(state: CombatState, root: Action, newId: () => string): Action[] {
  if (isVoided(state, root)) return []
  const opened = getReactionsTo(state, root.id).flatMap((reaction): Action[] => {
    const move = getMoveAfter(state, root, reaction)
    return move ? [openMove(reaction, newId, move)] : []
  })
  opened.push(...escapesOnStun(state, root, newId))
  if (root.kind === 'cast' && opensExplosion(state, root)) {
    opened.push(makeAction('explosion', { id: newId(), actorId: root.actorId, source: 'cast', key: root.key, spawnedBy: root.id }))
  }
  return opened
}

// combat.tex "Escape": each escape a stun opens, as a maneuver of the held
// one's that nobody may resist, for them to take or skip.
function escapesOnStun(state: CombatState, root: Action, newId: () => string): Action[] {
  return getStunEscapes(state, root).map(({ heldId, holderId }) =>
    makeAction('grapple', { maneuver: 'escape', unresisted: true, id: newId(), actorId: heldId, targetId: holderId, spawnedBy: root.id }))
}
