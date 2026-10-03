import { SPELLS, isSpellKey } from '../../spells'
import type { Action, CastAction, CombatState, ExplosionAction, FeintAction, FireAgainAction, QueuedTurn, RootAction, ThrowAction } from '../types'
import { getOpenAction, isForgone } from '../rules/log'
import { getSettled } from '../rules/settle'
import { getSpellTestTargets, isAreaSpell, opensExplosion } from '../rules/cast'
import { getDefaultAim } from '../rules/attack'
import { getTargetIds, hasPostChoice } from '../rules/action'
import { getNextShare, getNextSwept, isSweep } from '../rules/sweep'
import { findObject, getBlastOf, getImpactExplosion, isSpray } from '../rules/explosion'
import { isTying } from '../rules/tether'
import { isVoided } from '../rules/opportunity'
import { isInterruptedBy } from '../rules/interruption'
import { getAnsweringReactions, getOpener, getReactionsInOrder } from '../rules/openers'
import { getStunEscapes } from '../rules/grapple'
import { getRecipeFollowUps } from '../rules/recipes'
import { makeAction } from '../factories'
import { canTakeQueuedTurn, getFleeFollowUps, getFleersOf } from '../rules/flee'
import { getTurnHolder } from '../rules/turn'
import { getFeinted } from '../rules/feint'
import { appendActions, applyPhase, replaceActions } from './log'
import { closeTurn } from './closeTurn'

// What carries the fight on between the commands. Every action runs
// define → react → roll → post → effect; the actions its reactions open are
// played out between its roll and its effect, and the follow-ups its effect
// generates after it. Each is pushed onto the stack over the action that
// opened it, so the top is always the one the table is waiting on, and when
// it lands the action beneath picks up where it was. Not commands of their
// own — the action commands call these after every change.

// Carries the fight on from whatever is on top of the stack: a rolled action
// opens the next of the actions its reactions opened before its effect. One
// waiting on a declaration, an answer or a choice is left to it; one with
// nothing left to choose lands once its attacks are fought. A follow-up
// forgone for another its actor took is passed up. Once nothing is left on
// it, the turn goes to whoever is due to flee.
export function advance(state: CombatState, newId: () => string): CombatState {
  const top = getOpenAction(state)
  if (!top) return handOverToFleers(state)
  if (isForgone(state, top)) return advance(replaceActions(state, [{ ...top, step: 'done', declined: true }]), newId)
  if (top.step !== 'post') return state
  const opened = openBefore(state, top, newId)
  return opened === state && !hasPostChoice(state, top) ? land(state, top, newId) : opened
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
  return advance(appendActions(resolved.kind === 'feint' ? forceSurge(fled, resolved) : fled, followUps), newId)
}

// combat.tex "Turns and Actions" ("Feint"): the one the test went against "is
// forced to take their turn and use one action surge". The feinter's turn
// ends as any turn does when they won; when they lost it goes on, with the
// surge owed.
function forceSurge(state: CombatState, feint: FeintAction): CombatState {
  const feinted = getFeinted(feint)
  if (!feinted || !state.characters[feinted] || isVoided(state, feint)) return state
  const holder = getTurnHolder(state)
  if (holder === feinted) return { ...state, forcedSurge: feinted }
  const ended = holder ? closeTurn(state, holder) : state
  return { ...ended, inTurnCharacter: feinted, forcedSurge: feinted, turnStartedAt: state.actions.length, contenders: [], lastContest: null }
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

// combat.tex "Avoiding an Explosion": the explosion goes off as a blast,
// once the escapes the reflexes that cleared it open have been walked — so
// it goes beneath them.
function goOff(root: ExplosionAction, newId: () => string): Action {
  return makeAction('blast', { id: newId(), actorId: root.actorId, spawnedBy: root.id, key: root.key, effects: root.effects, center: root.center, paintOnly: root.paintOnly, step: 'post' })
}

// The follow-ups the landed action generates, the last played out first:
// the blast an explosion goes off as, beneath everything else; the flees it
// leaves, decided once everything else is; what its reactions open after
// it (rules/openers.ts), in the order they were declared; the escapes a stun
// opens, the tests a cast worked through a link puts its targets to, the
// explosion a cast that hit with an area to it goes off as,
// aimed and played out on its own (the caster's part is done), the one a
// thrown object goes off as where it lands, what
// the strike's recipes open (rules/recipes.ts: a hook's knockdown, an
// intercept's disarm, a riposte); and on top, the sweep's next target, so the
// swing is finished first.
// A voided action generates nothing (the table's ruling: no follow-ups for
// an interrupted action) but what a reaction opens `evenIfVoided`, and none
// is offered to one the action interrupted (`isInterruptedBy`).
export function getFollowUps(state: CombatState, root: RootAction, newId: () => string): Action[] {
  return generateFollowUps(state, root, newId).filter((a) => a.step !== 'define' || !isInterruptedBy(state, root, a.actorId))
}

function generateFollowUps(state: CombatState, root: RootAction, newId: () => string): Action[] {
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
    ...(root.kind === 'fireAgain' && isSpellKey(root.key) && isAreaSpell(root.key) ? [reaimedSpray(state, root, newId)] : []),
    ...(root.kind === 'throw' ? impactExplosion(state, root, newId) : []),
    ...getRecipeFollowUps(state, root, newId),
    ...openSweepLink(state, root, newId),
  ]
}

// combat.tex "Sweeping Attack": the strike at the sweep's next target, with
// what is left of the blow once past this one (combat.tex "Damage
// absorption"); nothing once nothing is left — an intercept stopped it, or
// it was absorbed — or nobody is. On a board it is committed at the next
// the arc reaches; on a fight without one, it is the attacker's to aim at
// anyone not yet swept, or to pass up to end the sweep.
function openSweepLink(state: CombatState, root: RootAction, newId: () => string): Action[] {
  if (root.kind !== 'strike' || !isSweep(root)) return []
  const share = getNextShare(state, root)
  if (share === 0) return []
  const { weaponKey, attack, variant, sweepDirection } = root
  const base = { id: newId(), actorId: root.actorId, weaponKey, attack, variant, sweepDirection, share, spawnedBy: root.id, sweepOf: root.sweepOf ?? root.id }
  if (state.board) {
    const next = getNextSwept(state, root)
    return next ? [makeAction('strike', { ...base, ...next, ...getDefaultAim(state.characters[next.targetId]), step: 'react' })] : []
  }
  const link = makeAction('strike', base)
  return getTargetIds(state, link).length > 0 ? [link] : []
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

// A held area spell aimed again (the table's ruling): its explosion, opened
// as a cast's is, lays the ground and harms nobody.
function reaimedSpray(state: CombatState, root: FireAgainAction, newId: () => string): ExplosionAction {
  const explosion = makeAction('explosion', { id: newId(), actorId: root.actorId, source: 'cast', key: root.key, spawnedBy: root.id, paintOnly: true })
  return isSpray(getBlastOf(state, explosion)) ? { ...explosion, step: 'react' } : explosion
}

// spells.tex "Charged": a thrown object whose charge goes off on impact
// goes off where it landed, committed as it opens — there is nothing to
// aim — for everyone its area reaches to answer with their reflexes.
function impactExplosion(state: CombatState, root: ThrowAction, newId: () => string): ExplosionAction[] {
  const tied = root.thrown ? null : findObject(state, root.itemId)
  const item = root.thrown ?? (tied && isTying(tied) ? tied : null)
  const explosion = item && root.to ? getImpactExplosion(state, root.actorId, item, root.to, { id: newId(), spawnedBy: root.id, step: 'react' }) : null
  return explosion ? [explosion] : []
}

// spells.tex "Telepathic Link": a test for each target of a cast worked
// through a link, committed as it opens — nobody answers it, and it waits
// only on the target's die.
function openSpellTests(state: CombatState, root: RootAction, newId: () => string): Action[] {
  if (root.kind !== 'cast') return []
  return getSpellTestTargets(state, root).map((targetId) => makeAction('spellTest', { id: newId(), actorId: root.actorId, targetId, key: root.key, spawnedBy: root.id, step: 'react' }))
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
