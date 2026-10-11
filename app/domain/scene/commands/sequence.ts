import { SPELLS, isSpellKey } from '../../spells'
import type { Action, AttackAction, CastAction, SceneState, ExplosionAction, FeintAction, FireAgainAction, QueuedTurn, RootAction, ThrowAction } from '../types'
import { getOpenAction, isForgone } from '../rules/log'
import { getSettled } from '../rules/settle'
import { getSpellTestTargets, isAreaSpell, opensExplosion } from '../rules/cast'
import { getDefaultAim, isStoppedByGuard } from '../rules/attack'
import { getTargetIds, hasPostChoice } from '../rules/action'
import { getNextShare, getNextSwept, isSweep } from '../rules/sweep'
import { findObject, getBlastOf, getImpactExplosion, isSpray } from '../rules/explosion'
import { getFloorObject, getAttackExplosion } from '../rules/floorAttack'
import { isTying } from '../rules/tether'
import { isVoided } from '../rules/opportunity'
import { isInterruptedBy } from '../rules/interruption'
import { getAnsweringReactions, getOpener, getReactionsInOrder } from '../rules/openers'
import { getLapsedDefenses, getPendingReposition } from '../rules/prepared'
import { getStunEscapes } from '../rules/grapple'
import { getRecipeFollowUps } from '../rules/recipes'
import { makeAction } from '../factories'
import { canTakeQueuedTurn, getFleeFollowUps, getFleersOf } from '../rules/flee'
import { getTurnHolder } from '../rules/turn'
import { getHeldRoll } from '../rules/heldRoll'
import { isHeldCalled } from '../rules/heldTest'
import { getFeinted } from '../rules/feint'
import { getNextStress } from '../rules/stress'
import { appendActions, applyPhase, replaceActions, withdrawActions } from './log'
import { closeTurn } from './closeTurn'
import { getResults } from './results'
import { compelByTest } from './stress'
import { getHiddenFrom } from '../rules/stealth'

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
export function advance(state: SceneState, newId: () => string): SceneState {
  const top = getOpenAction(state)
  if (!top) return handOverToFleers(handOverToCompelled(state))
  if (isForgone(state, top)) return advance(withdrawActions(state, [top.id], 'forgone'), newId)
  if (top.step !== 'post') return state
  const opened = openBefore(state, top, newId)
  return opened === state && !hasPostChoice(state, top) ? land(state, top, newId) : opened
}

// The action's effect: settled as it stands, landed on everyone it
// concerns, and closed, with the follow-ups it generates pushed over the
// action beneath, and the fight carried on from there. Whoever it sends
// fleeing flees once everything on the stack has been played out.
export function land(state: SceneState, open: RootAction, newId: () => string): SceneState {
  const settled = getSettled(state, open)
  const resolved = { ...settled, results: getResults(state, settled) }
  const landed = applyPhase(replaceActions(state, [resolved]), [resolved], 'resolve')
  const fled = { ...landed, fleers: [...landed.fleers, ...getFleersOf(landed, resolved)] }
  const followUps = getFollowUps(fled, resolved, newId).map((a) => (a.step === 'define' ? { ...a, followUpOf: resolved.id } : a))
  const forced = resolved.kind === 'feint' ? forceSurge(fled, resolved) : resolved.kind === 'spellTest' ? compelByTest(fled, resolved) : fled
  return advance(appendActions(forced, followUps), newId)
}

// combat.tex "Turns and Actions" ("Feint"): the one the test went against "is
// forced to take their turn and use one action surge". The feinter's turn
// ends as any turn does when they won; when they lost it goes on, with the
// surge owed.
function forceSurge(state: SceneState, feint: FeintAction): SceneState {
  const feinted = getFeinted(feint)
  if (!feinted || !state.characters[feinted] || isVoided(state, feint)) return state
  const holder = getTurnHolder(state)
  if (holder === feinted) return { ...state, forcedSurge: feinted }
  const ended = holder ? closeTurn(state, holder) : state
  return { ...beginTurn(ended, feinted), forcedSurge: feinted }
}

// combat.tex "Compulsions": "They must occur immediately" — a limit stress
// action a spell's test activated is taken as a feint's surge is (the
// table's ruling), once nothing is being played out: whoever holds the turn
// ends it, a compelled turn of their own with it, and the compelled begins
// theirs.
function handOverToCompelled(state: SceneState): SceneState {
  const next = getNextStress(state)
  const holder = getTurnHolder(state)
  if (!next || next.by === '' || holder === next.id) return state
  const settled = holder ? { ...state, compulsions: state.compulsions.map((t) => (t.id === holder && !t.taken ? { ...t, taken: true } : t)) } : state
  return beginTurn(holder ? closeTurn(settled, holder) : settled, next.id)
}

// The character's turn begins: nobody has asked to contest it yet, and it
// is numbered `turn` — a fresh one unless it is one resumed.
export function beginTurn(state: SceneState, id: string, { fleeing = false, turn = null }: { fleeing?: boolean; turn?: number | null } = {}): SceneState {
  const begun = turn === null ? state.turnsBegun + 1 : state.turnsBegun
  return noteHiddenFrom({ ...state, inTurnCharacter: id, fleeing, turn: turn ?? begun, turnsBegun: begun, contenders: [], lastContest: null }, id)
}

// combat.tex "Actions in stealth": whom the holder begins the turn
// undetected by, noted once for the turn; a turn resumed keeps what it began
// with.
function noteHiddenFrom(state: SceneState, id: string): SceneState {
  if (state.stealthTurns.some((t) => t.turn === state.turn && t.id === id)) return state
  return { ...state, stealthTurns: [...state.stealthTurns, { turn: state.turn, id, hiddenFrom: getHiddenFrom(state, id), AP: 0, heardAP: 0 }] }
}

// combat.tex "Flee": "This reaction interrupts the opponents turn, which is
// resumed after the flee." Once nothing is being played out, the turn is
// put aside — not ended, so what its surge left is kept — and everyone due
// to flee takes a flee turn in the order they declared it, the interrupted
// turn after them.
export function handOverToFleers(state: SceneState): SceneState {
  if (state.fleers.length === 0 || getOpenAction(state)) return state
  const fleers = [...new Set(state.fleers)].map((id): QueuedTurn => ({ id, fleeing: true, turn: null }))
  const holder = getTurnHolder(state)
  const resumed: QueuedTurn[] = holder ? [{ id: holder, fleeing: state.fleeing, turn: state.turn }] : []
  return takeQueuedTurn({ ...state, fleers: [], inTurnCharacter: '', fleeing: false, contenders: [], turnQueue: [...fleers, ...resumed, ...state.turnQueue] })
}

// The next turn waiting in the queue is taken, passing over anyone no longer
// able to take it: a flee as a fresh turn, an interrupted one as it was.
export function takeQueuedTurn(state: SceneState): SceneState {
  const [next, ...rest] = state.turnQueue
  if (!next) return state
  const queued = { ...state, turnQueue: rest }
  if (!canTakeQueuedTurn(state, next.id)) return takeQueuedTurn(queued)
  return beginTurn(queued, next.id, { fleeing: next.fleeing, turn: next.turn })
}

// combat.tex "Preparing a reaction": a defense prepared for an ally is made
// from the line its preparer has walked to, and the die is scored against the
// defense as it stands, so the movement each carries is played out first — the
// next of them opened, a move of the preparer's own to make or pass up, which
// draws opportunity attacks like any other — and the die waits. Once every
// movement has been walked, the defenses it left off the line, or cancelled by
// what the movement drew, come to nothing.
export function repositionDefenders(state: SceneState, root: RootAction, newId: () => string): { state: SceneState; waiting: boolean } {
  const pending = getPendingReposition(state, root)
  if (pending) {
    const { reaction, budget } = pending
    return { state: appendActions(state, [makeAction('move', { id: newId(), actorId: reaction.actorId, spawnedBy: reaction.id, preparedPart: 'move', budget })]), waiting: true }
  }
  return { state: withdrawActions(state, getLapsedDefenses(state, root).map((r) => r.id), 'noLongerTriggered'), waiting: false }
}

// What the root's reactions open before its effect, the next of them once
// the one before has landed, in the order `getReactionsInOrder` gives
// (rules/openers.ts).
function openBefore(state: SceneState, root: RootAction, newId: () => string): SceneState {
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
  return makeAction('blast', { id: newId(), actorId: root.actorId, spawnedBy: root.id, key: root.key, effects: root.effects, center: root.center, paintOnly: root.paintOnly, armorRolls: root.armorRolls, step: 'post' })
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
// intercept's disarm, a riposte); the sweep's next target, so the swing is
// finished first; and on top, the fall a move ended in.
// A voided action generates nothing (the table's ruling: no follow-ups for
// an interrupted action) but what a reaction opens `evenIfVoided`, and none
// is offered to one the action interrupted (`isInterruptedBy`).
export function getFollowUps(state: SceneState, root: RootAction, newId: () => string): Action[] {
  return generateFollowUps(state, root, newId).filter((a) => a.step !== 'define' || !isInterruptedBy(state, root, a.actorId))
}

function generateFollowUps(state: SceneState, root: RootAction, newId: () => string): Action[] {
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
    ...(root.kind === 'strike' || root.kind === 'shoot' ? struckExplosion(state, root, newId) : []),
    ...getRecipeFollowUps(state, root, newId),
    ...openSweepLink(state, root, newId),
    ...openSwimTest(state, root, newId),
    ...openFall(root, newId),
  ]
}

// combat.tex "Balance": a move that ended in a fall — down a jump, off a
// climb that failed — has its mover make the fall test before anything else
// is played out, committed as it opens: nobody answers it, and it waits only
// on the faller's die.
function openFall(root: RootAction, newId: () => string): Action[] {
  const fall = root.kind === 'move' ? root.facts?.fall : null
  return fall ? [makeAction('fall', { id: newId(), actorId: root.actorId, height: fall.height, to: fall.to, spawnedBy: root.id, step: 'react' })] : []
}

// combat.tex "Swimming": a move that left its mover in the water, who has not
// tested this round, has them make the swimming check, committed as it opens:
// nobody answers it, and it waits only on the swimmer's die. The fall a move
// ended in is played out before it.
function openSwimTest(state: SceneState, root: RootAction, newId: () => string): Action[] {
  const owed = root.kind === 'move' && isHeldCalled(state, root.actorId, 'swim') && getHeldRoll(state, root.actorId, 'swim') === null
  return owed ? [makeAction('swimTest', { id: newId(), actorId: root.actorId, spawnedBy: root.id, step: 'react' })] : []
}

// combat.tex "Sweeping Attack": the strike at the sweep's next target, with
// what is left of the blow once past this one (combat.tex "Damage
// absorption"); nothing once nothing is left — an intercept stopped it, or
// it was absorbed — or nobody is. On a board it is committed at the next
// the arc reaches; on a fight without one, it is the attacker's to aim at
// anyone not yet swept, or to pass up to end the sweep.
function openSweepLink(state: SceneState, root: RootAction, newId: () => string): Action[] {
  if (root.kind !== 'strike' || !isSweep(root)) return []
  const share = getNextShare(state, root)
  if (share === 0) return []
  const { weaponKey, attack, variant, sweepDirection } = root
  const base = { id: newId(), actorId: root.actorId, weaponKey, attack, variant, sweepDirection, share, spawnedBy: root.id, sweepOf: root.sweepOf ?? root.id, swept: [...root.swept, ...(root.targetId ? [root.targetId] : [])] }
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
function castExplosion(state: SceneState, root: CastAction, newId: () => string): ExplosionAction {
  const detonates = isSpellKey(root.key) && SPELLS[root.key].detonate !== null
  const explosion = makeAction('explosion', { id: newId(), actorId: root.actorId, source: detonates ? 'detonate' : 'cast', key: detonates ? '' : root.key, spawnedBy: root.id })
  if (detonates) return explosion
  return isSpray(getBlastOf(state, explosion)) ? { ...explosion, step: 'react' } : explosion
}

// A held area spell aimed again (the table's ruling): its explosion, opened
// as a cast's is, lays the ground and harms nobody.
function reaimedSpray(state: SceneState, root: FireAgainAction, newId: () => string): ExplosionAction {
  const explosion = makeAction('explosion', { id: newId(), actorId: root.actorId, source: 'cast', key: root.key, spawnedBy: root.id, paintOnly: true })
  return isSpray(getBlastOf(state, explosion)) ? { ...explosion, step: 'react' } : explosion
}

// spells.tex "Charged": a thrown object whose charge goes off on impact
// goes off where it landed, committed as it opens — there is nothing to
// aim — for everyone its area reaches to answer with their reflexes.
function impactExplosion(state: SceneState, root: ThrowAction, newId: () => string): ExplosionAction[] {
  const tied = root.thrown ? null : findObject(state, root.itemId)
  const item = root.thrown ?? (tied && isTying(tied) ? tied : null)
  const explosion = item && root.to ? getImpactExplosion(state, root.actorId, item, root.to, { id: newId(), spawnedBy: root.id, step: 'react' }) : null
  return explosion ? [explosion] : []
}

// spells.tex "Charged": a hit or a critical, by a blow or a shot, on an object
// lying on the floor whose charge goes off on impact sets it off where it
// lies, committed as it opens like a thrown one's.
function struckExplosion(state: SceneState, root: AttackAction, newId: () => string): ExplosionAction[] {
  const found = getFloorObject(state, root)
  const degree = root.roll?.degree
  if (!found || (degree !== 'hit' && degree !== 'critical') || isStoppedByGuard(state, root)) return []
  const explosion = getAttackExplosion(state, root, found, { id: newId(), spawnedBy: root.id, step: 'react' })
  return explosion ? [explosion] : []
}

// spells.tex "Telepathic Link": a test for each target of a cast worked
// through a link, committed as it opens — nobody answers it, and it waits
// only on the target's die.
function openSpellTests(state: SceneState, root: RootAction, newId: () => string): Action[] {
  if (root.kind !== 'cast') return []
  return getSpellTestTargets(state, root).map((targetId) => makeAction('spellTest', { id: newId(), actorId: root.actorId, targetId, key: root.key, spawnedBy: root.id, step: 'react' }))
}

// combat.tex "Escape": each escape a stun opens, as a maneuver of the held
// one's that nobody may resist, for them to take or skip.
function escapesOnStun(state: SceneState, root: RootAction, newId: () => string): Action[] {
  return getStunEscapes(state, root).map(({ heldId, holderId }) =>
    makeAction('grapple', { maneuver: 'escape', unresisted: true, id: newId(), actorId: heldId, targetId: holderId, spawnedBy: root.id }))
}

// combat.tex "Flee": "after receiving a melee attack" — the flee each one
// the landed action leaves free to flee may take or pass up, the one who
// answered first played out first.
function openFlees(state: SceneState, root: RootAction, newId: () => string): Action[] {
  return getFleeFollowUps(state, root).reverse().map((id) => makeAction('fleeFollowUp', { id: newId(), actorId: id, spawnedBy: root.id }))
}
