import type { Action, CastAction, CombatState, ExplosionAction, MoveAction } from '../types'
import { getOpenAction, getReactionsTo } from '../rules/log'
import { getTriggers } from '../rules/reactions'
import { getSettled } from '../rules/settle'
import { opensExplosion } from '../rules/cast'
import { getAttackOptions, getOpportunityAction, getOpportunityState, getOpportunityStop, isOpportunityReached } from '../rules/attack'
import { isInReach } from '../rules/board'
import { getBlastOf, isSpray } from '../rules/explosion'
import { getMoveAfter, getMoveBeforeBlast, type ReactionMove } from '../rules/reactionMoves'
import { getDrawnOpportunityAttacks, isFlankInReach, isInterruptingStrike, isTriggeringAction, isVoided } from '../rules/opportunity'
import { getCounterattack, getCounterSlot, getCounterStrike, getCounterStrikeOf, type CounterSlot } from '../rules/counter'
import { getRiposteOpening } from '../rules/riposte'
import { getDisplacement, getStunEscapes } from '../rules/grapple'
import { makeAction } from '../factories'
import { appendActions, applyPhase, replaceActions } from './log'

// What carries the fight on between the commands. Every action runs
// define → react → roll → post → effect; the actions its reactions open are
// played out between its roll and its effect, and the follow-ups its effect
// generates after it. Each is pushed onto the stack over the action that
// opened it, so the top is always the one the table is waiting on, and when
// it lands the action beneath picks up where it was. Not commands of their
// own — the action commands call these after every change.

// Carries the fight on from whatever is on top of the stack: a rolled action
// opens the next of the actions its reactions opened before its effect. One
// waiting on a declaration, an answer or a choice is left to it — except
// those with nothing of their own left to decide, which land once their
// attacks are fought: an explosion, and a displacement, which nobody able to
// answer it is walked at once.
export function advance(state: CombatState, newId: () => string): CombatState {
  const top = getOpenAction(state)
  if (!top) return state
  if (top.kind === 'displace' && top.step === 'react' && getTriggers(state, top).length === 0) {
    return advance(replaceActions(state, [{ ...top, step: 'post', cost: { AP: 0, STA: 0 } }]), newId)
  }
  if (top.step !== 'post') return state
  const opened = openBefore(state, top, newId)
  return opened === state && (top.kind === 'displace' || top.kind === 'explosion') ? land(state, top, newId) : opened
}

// The action's effect: settled as it stands, landed on everyone it
// concerns, and closed, with the follow-ups it generates pushed over the
// action beneath, and the fight carried on from there.
export function land(state: CombatState, open: Action, newId: () => string): CombatState {
  const resolved = getSettled(state, open)
  const landed = applyPhase(replaceActions(state, [resolved]), [resolved], 'resolve')
  return advance(appendActions(landed, getFollowUps(landed, resolved, newId)), newId)
}

// combat.tex "Opportunity Attack": "The attack occurs before the effect of
// the triggering action." The attacks a move, a strike or a triggering
// action drew are opened one at a time in the order it comes to them, each
// once the one before has landed; a move or a push has everyone it carries
// stood one space short of the stretch the next one fires on while it is
// fought. The run ends once the root is brought to a stop, or at an attack
// on a stretch it never reaches; a flanker the attacker has got out of
// range of is passed over (combat.tex "Flanking").
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
  return appendActions(state, openCounter(state, root, ['before', 'tie'], newId))
}

// abilities.tex "Counterattack": "The attack with the higher result hits
// first" — the counterattack's strike, opened ahead of the attack's effect
// when it rolled higher or the same (the table's ruling: a tie lands both,
// neither interrupting the other), after it when it rolled lower, unless the
// attack interrupted the one who made it.
function openCounter(state: CombatState, root: Action, slots: CounterSlot[], newId: () => string): Action[] {
  const reaction = getCounterattack(state, root)
  const slot = reaction ? getCounterSlot(root, reaction) : null
  if (!reaction || !slot || !slots.includes(slot) || getCounterStrikeOf(state, reaction)) return []
  if (slot === 'after' && isInterruptingStrike(root, reaction.actorId)) return []
  return [getCounterStrike(reaction, newId())]
}

// abilities.tex "Riposte": the defender's attack after a melee attack their
// defense made miss or graze, aimed back at the attacker "if in range" —
// some strike they hold reaches — for them to declare or pass up.
function openRiposte(state: CombatState, root: Action, newId: () => string): Action[] {
  const defense = getRiposteOpening(state, root)
  const riposter = defense ? state.characters[defense.actorId] : undefined
  if (!defense || !riposter) return []
  const strike = makeAction('strike', { id: newId(), actorId: defense.actorId, targetId: root.actorId, spawnedBy: defense.id })
  const reaches = getAttackOptions(riposter, 'strike').some((o) => isInReach(state, { ...strike, ...o }, root.actorId))
  return reaches ? [strike] : []
}

// combat.tex "Avoiding an Explosion": the explosion goes off as a blast,
// once the escapes the reflexes that cleared it open have been walked —
// pushed over the blast, so they are played out first; one whose test
// missed moves after the blast instead, its follow-up.
function goOff(state: CombatState, root: ExplosionAction, newId: () => string): Action[] {
  const blast = makeAction('blast', { id: newId(), actorId: root.actorId, spawnedBy: root.id, key: root.key, effects: root.effects, center: root.center, step: 'post' })
  const escapes = getReactionsTo(state, root.id).flatMap((reaction): Action[] => {
    const move = getMoveBeforeBlast(reaction)
    return move ? [openMove(reaction, newId, move)] : []
  })
  return [blast, ...escapes]
}

// The move a reaction opens for its reactor.
function openMove(reaction: Action, newId: () => string, fields: ReactionMove): MoveAction {
  return makeAction('move', { ...fields, id: newId(), actorId: reaction.actorId, spawnedBy: reaction.id })
}

// The follow-ups the landed action generates, in the order they were
// declared: the moves its reactions grant once it has landed — a blast's,
// those of the reflexes against the explosion it went off from — the
// escapes a stun opens, the way a push was pointed, walked, the blast an
// explosion goes off as, and the explosion a cast that hit with an area to
// it goes off as, aimed and played out on its own (the caster's part is
// done), and a riposte. Its opportunity attacks were opened before it landed
// (`openBefore`). A voided action generates nothing (the table's ruling: no
// follow-ups for an interrupted action) — but the counterattack that rolled
// lower than it, which is its target's attack, not its own.
export function getFollowUps(state: CombatState, root: Action, newId: () => string): Action[] {
  const counter = openCounter(state, root, ['after'], newId)
  if (isVoided(state, root)) return counter
  if (root.kind === 'explosion') return goOff(state, root, newId)
  const answered = root.kind === 'blast' && root.spawnedBy ? root.spawnedBy : root.id
  const opened = getReactionsTo(state, answered).flatMap((reaction): Action[] => {
    const move = getMoveAfter(state, root, reaction)
    return move ? [openMove(reaction, newId, move)] : []
  })
  opened.push(...escapesOnStun(state, root, newId))
  const displacement = root.kind === 'drag' ? getDisplacement(state, root) : null
  if (displacement) opened.push(makeAction('displace', { ...displacement, id: newId(), actorId: root.actorId, spawnedBy: root.id, step: 'react' }))
  if (root.kind === 'cast' && opensExplosion(state, root)) opened.push(castExplosion(state, root, newId))
  return [...counter, ...opened, ...openRiposte(state, root, newId)]
}

// The explosion a cast goes off as: to be aimed, a disk; a spray has nothing
// to aim before the reflexes, only a range to show them (combat.tex
// "Sprays"), so it is committed as it opens.
function castExplosion(state: CombatState, root: CastAction, newId: () => string): ExplosionAction {
  const explosion = makeAction('explosion', { id: newId(), actorId: root.actorId, source: 'cast', key: root.key, spawnedBy: root.id })
  return isSpray(getBlastOf(state, explosion)) ? { ...explosion, step: 'react' } : explosion
}

// combat.tex "Escape": each escape a stun opens, as a maneuver of the held
// one's that nobody may resist, for them to take or skip.
function escapesOnStun(state: CombatState, root: Action, newId: () => string): Action[] {
  return getStunEscapes(state, root).map(({ heldId, holderId }) =>
    makeAction('grapple', { maneuver: 'escape', unresisted: true, id: newId(), actorId: heldId, targetId: holderId, spawnedBy: root.id }))
}
