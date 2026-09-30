import { SPELLS, isSpellKey } from '../../spells'
import type { Action, CastAction, CombatState, ExplosionAction, QueuedTurn, RootAction, ThrowAction } from '../types'
import { getOpenAction, isForgone } from '../rules/log'
import { getSettled } from '../rules/settle'
import { getSpellTestTargets, opensExplosion } from '../rules/cast'
import { getAttackOptions } from '../rules/attack'
import { isInReach } from '../rules/board'
import { getBlastOf, getExplosionPayload, goesOffOnImpact, isSpray } from '../rules/explosion'
import { isVoided } from '../rules/opportunity'
import { getAnsweringReactions, getOpener, getReactionsInOrder } from '../rules/openers'
import { getRiposteOpening } from '../rules/riposte'
import { getDisarmOptions, getInterceptDisarmOpening, getStunEscapes } from '../rules/grapple'
import { getHookKnockdown } from '../rules/damage'
import { makeAction } from '../factories'
import { canTakeQueuedTurn, getFleeFollowUps, getFleersOf } from '../rules/flee'
import { getTurnHolder } from '../rules/turn'
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
// attacks are fought: an explosion, a push, a flee, and a spell's test. A follow-up forgone
// for another its actor took is passed up. Once nothing is left on it, the
// turn goes to whoever is due to flee.
export function advance(state: CombatState, newId: () => string): CombatState {
  const top = getOpenAction(state)
  if (!top) return handOverToFleers(state)
  if (isForgone(state, top)) return advance(replaceActions(state, [{ ...top, step: 'done', declined: true }]), newId)
  if (top.step !== 'post') return state
  const opened = openBefore(state, top, newId)
  return opened === state && (top.kind === 'drag' || top.kind === 'explosion' || top.kind === 'fleeFollowUp' || top.kind === 'spellTest') ? land(state, top, newId) : opened
}

// The action's effect: settled as it stands, landed on everyone it
// concerns, and closed, with the follow-ups it generates pushed over the
// action beneath, and the fight carried on from there. Whoever it sends
// fleeing flees once everything on the stack has been played out.
export function land(state: CombatState, open: RootAction, newId: () => string): CombatState {
  const resolved = getSettled(state, open)
  const landed = applyPhase(replaceActions(state, [resolved]), [resolved], 'resolve')
  const fled = { ...landed, fleers: [...landed.fleers, ...getFleersOf(landed, resolved)] }
  const followUps = getFollowUps(fled, resolved, newId).map((a) => (a.step === 'define' ? { ...a, followUpOf: resolved.id } : a))
  return advance(appendActions(fled, followUps), newId)
}

// combat.tex "Flee": "This reaction interrupts the opponents turn, which is
// resumed after the flee." Once nothing is being played out, the turn is
// put aside — not ended, so what its surge left is kept — and everyone due
// to flee takes a flee turn in the order they declared it, the interrupted
// turn after them.
export function handOverToFleers(state: CombatState): CombatState {
  if (state.fleers.length === 0 || getOpenAction(state)) return state
  const fleers = [...new Set(state.fleers)].map((id): QueuedTurn => ({ id, fleeing: true, startedAt: null }))
  const holder = getTurnHolder(state)
  const resumed: QueuedTurn[] = holder ? [{ id: holder, fleeing: state.fleeing, startedAt: state.turnStartedAt }] : []
  return takeQueuedTurn({ ...state, fleers: [], inTurnCharacter: '', fleeing: false, contenders: [], turnQueue: [...fleers, ...resumed, ...state.turnQueue] })
}

// The next turn waiting in the queue is taken, passing over anyone no longer
// able to take it: a flee as a fresh turn, an interrupted one as it was.
export function takeQueuedTurn(state: CombatState): CombatState {
  const [next, ...rest] = state.turnQueue
  if (!next) return state
  const queued = { ...state, turnQueue: rest }
  if (!canTakeQueuedTurn(state, next.id)) return takeQueuedTurn(queued)
  return { ...queued, inTurnCharacter: next.id, fleeing: next.fleeing, turnStartedAt: next.startedAt ?? state.actions.length, contenders: [], lastContest: null }
}

// What the root's reactions open before its effect, the next of them once
// the one before has landed, in the order `getReactionsInOrder` gives
// (rules/openers.ts).
function openBefore(state: CombatState, root: RootAction, newId: () => string): CombatState {
  for (const reaction of getReactionsInOrder(state, root)) {
    const opened = getOpener(reaction).before?.(state, root, reaction, newId)
    if (opened) return appendActions(opened.state, [opened.action])
  }
  return state
}

// abilities.tex "Riposte": the defender's attack after a melee attack their
// defense made miss or graze, aimed back at the attacker "if in range" —
// some strike they hold reaches — for them to declare or pass up.
function openRiposte(state: CombatState, root: RootAction, newId: () => string): Action[] {
  const defense = getRiposteOpening(state, root)
  const riposter = defense ? state.characters[defense.actorId] : undefined
  if (!defense || !riposter) return []
  const strike = makeAction('strike', { id: newId(), actorId: defense.actorId, targetId: root.actorId, spawnedBy: defense.id })
  const reaches = getAttackOptions(riposter, 'strike').some((o) => isInReach(state, { ...strike, ...o }, root.actorId))
  return reaches ? [strike] : []
}

// combat.tex "Avoiding an Explosion": the explosion goes off as a blast,
// once the escapes the reflexes that cleared it open have been walked — so
// it goes beneath them.
function goOff(root: ExplosionAction, newId: () => string): Action {
  return makeAction('blast', { id: newId(), actorId: root.actorId, spawnedBy: root.id, key: root.key, effects: root.effects, center: root.center, step: 'post' })
}

// The follow-ups the landed action generates, the last played out first:
// the blast an explosion goes off as, beneath everything else; the flees it
// leaves, decided once everything else is; what its reactions open after
// it (rules/openers.ts), in the order they were declared; the escapes a stun
// opens, the tests a cast worked through a link puts its targets to, the
// explosion a cast that hit with an area to it goes off as,
// aimed and played out on its own (the caster's part is done), the one a
// thrown object goes off as where it lands, the
// knockdown a hook opens, the disarm an intercept opens; and on top, a
// riposte.
// A voided action generates nothing (the table's ruling: no follow-ups for
// an interrupted action) but what a reaction opens `evenIfVoided`.
export function getFollowUps(state: CombatState, root: RootAction, newId: () => string): Action[] {
  const voided = isVoided(state, root)
  const blast = root.kind === 'explosion' && !voided ? [goOff(root, newId)] : []
  const opened = getAnsweringReactions(state, root).flatMap((reaction) => {
    const opener = getOpener(reaction)
    return opener.after && (!voided || opener.evenIfVoided) ? opener.after(state, root, reaction, newId) : []
  })
  if (voided) return opened
  return [
    ...blast,
    ...openFlees(state, root, newId),
    ...opened,
    ...escapesOnStun(state, root, newId),
    ...openSpellTests(state, root, newId),
    ...(root.kind === 'cast' && opensExplosion(state, root) ? [castExplosion(state, root, newId)] : []),
    ...(root.kind === 'throw' ? impactExplosion(state, root, newId) : []),
    ...openHookKnockdown(state, root, newId),
    ...openInterceptDisarm(state, root, newId),
    ...openRiposte(state, root, newId),
  ]
}

// The explosion a cast goes off as: to be aimed, a disk; a spray has nothing
// to aim before the reflexes, only a range to show them (combat.tex
// "Sprays"), so it is committed as it opens. A detonating spell's is the
// charge the caster picks next (spells.tex "Detonate Explosive").
function castExplosion(state: CombatState, root: CastAction, newId: () => string): ExplosionAction {
  const detonates = isSpellKey(root.key) && SPELLS[root.key].detonate !== null
  const explosion = makeAction('explosion', { id: newId(), actorId: root.actorId, source: detonates ? 'detonate' : 'cast', key: detonates ? '' : root.key, spawnedBy: root.id })
  if (detonates) return explosion
  return isSpray(getBlastOf(state, explosion)) ? { ...explosion, step: 'react' } : explosion
}

// spells.tex "Charged": a thrown object whose charge goes off on impact
// goes off where it landed, committed as it opens — there is nothing to
// aim — for everyone its area reaches to answer with their reflexes.
function impactExplosion(state: CombatState, root: ThrowAction, newId: () => string): ExplosionAction[] {
  if (!root.thrown || !root.to || !goesOffOnImpact(root.thrown)) return []
  const explosion = makeAction('explosion', { id: newId(), actorId: root.actorId, source: 'thrown', itemId: root.thrown.id, center: root.to, spawnedBy: root.id, step: 'react' })
  return getExplosionPayload(state, explosion) ? [explosion] : []
}

// spells.tex "Telepathic Link": a test for each target of a cast worked
// through a link, committed as it opens — nobody answers it, and it waits
// only on the target's die.
function openSpellTests(state: CombatState, root: RootAction, newId: () => string): Action[] {
  if (root.kind !== 'cast') return []
  return getSpellTestTargets(state, root).map((targetId) => makeAction('spellTest', { id: newId(), actorId: root.actorId, targetId, key: root.key, spawnedBy: root.id, step: 'react' }))
}

// combat.tex "Hook Attack": the knockdown the hook opens, for the hooker to
// take or skip, unresisted against one running or jumping.
function openHookKnockdown(state: CombatState, root: RootAction, newId: () => string): Action[] {
  const knockdown = root.kind === 'strike' ? getHookKnockdown(state, root) : null
  if (!knockdown || root.kind !== 'strike') return []
  return [makeAction('grapple', { maneuver: 'knockdown', hook: true, unresisted: knockdown.unresisted, id: newId(), actorId: root.actorId, targetId: root.targetId, spawnedBy: root.id })]
}

// combat.tex "Escape": each escape a stun opens, as a maneuver of the held
// one's that nobody may resist, for them to take or skip.
function escapesOnStun(state: CombatState, root: RootAction, newId: () => string): Action[] {
  return getStunEscapes(state, root).map(({ heldId, holderId }) =>
    makeAction('grapple', { maneuver: 'escape', unresisted: true, id: newId(), actorId: heldId, targetId: holderId, spawnedBy: root.id }))
}

// combat.tex "Flee": "after receiving a melee attack" — the flee each one
// the landed action leaves free to flee may take or pass up, the one who
// answered first played out first.
function openFlees(state: CombatState, root: RootAction, newId: () => string): Action[] {
  return getFleeFollowUps(state, root).reverse().map((id) => makeAction('fleeFollowUp', { id: newId(), actorId: id, spawnedBy: root.id }))
}

// combat.tex "Disarm": "Can be used by spending +1AP+1STA when intercept
// stops an attack" — a disarm the interceptor may declare or pass up, at
// whoever they intercepted, with something of theirs to take.
function openInterceptDisarm(state: CombatState, root: RootAction, newId: () => string): Action[] {
  if (root.kind !== 'strike') return []
  const intercept = getInterceptDisarmOpening(state, root)
  if (!intercept) return []
  const draft = makeAction('grapple', { maneuver: 'disarm', id: newId(), actorId: intercept.actorId, targetId: root.actorId, spawnedBy: intercept.id })
  return getDisarmOptions(state, draft).length > 0 ? [draft] : []
}
