import { ActionSchema, type Action, type ActionDraft, type ActionRoll, type CombatState, type Updater } from '../types'
import { ACTIONS, isReaction } from '../rules/actionCatalog'
import { areReactionsComplete, getNextStep, getPayableCost, getTargetIds, isAnswerable, isDeclarationComplete, needsDie, needsTarget } from '../rules/action'
import { canAnswer, getLiveReactionsTo, getOpenAction, getOpeningReaction, getReactionsTo, getRootOf } from '../rules/log'
import { findOption } from '../rules/options'
import { getReactionTest, getRootTest } from '../rules/attack'
import { resolveTest } from '../rules/test'
import { findTrigger } from '../rules/reactions'
import type { Dice } from '../dice'
import { getCancellableRoot } from '../rules/opportunity'
import { getDragComparison } from '../rules/grapple'
import { getSettled } from '../rules/settle'
import { appendActions, applyPhase, pruneReactions, replaceActions, withoutLiveReaction } from './log'
import { advanceOpportunities, afterLanding, afterPaying, fightPush, spawn } from './sequence'

// The phases of an action, as commands. Everything up to the roll only edits
// the action record and is free to undo: the declaration is edited, then
// `commitAction` locks it so its triggers can be loaded and answered;
// `rollAction` (or `payAction`, for an action with no die) throws the die and
// takes the price in one update, and from there the only way forward is
// `resolveAction`. Every command returns the state unchanged when asked for
// something the phase does not allow, so the store can dispatch blindly.

// Opens an action for a character. One at a time: nothing can be declared
// while another action is still being played out. Refuses exactly what the
// character's action list shows as closed.
export function declareAction(actorId: string, draft: ActionDraft, newId: () => string): Updater {
  return (state) => {
    if (getOpenAction(state) || isReaction(draft.kind)) return state
    if (!findOption(state, actorId, draft)?.available) return state
    const action = ActionSchema.parse({ ...draft, id: newId(), actorId })
    return appendActions(state, [action])
  }
}

// Fills in or changes what the open action declares, while it is still only
// declared. The kind is not a declaration and cannot change.
export function amendAction(fields: Partial<ActionDraft>): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared') return state
    if (fields.kind !== undefined && fields.kind !== open.kind) return state
    return replaceActions(state, [ActionSchema.parse({ ...open, ...fields, kind: open.kind })])
  }
}

// Aims the open action.
export function setTarget(targetId: string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared') return state
    if (!getTargetIds(state, open).includes(targetId)) return state
    return replaceActions(state, [{ ...open, targetId }])
  }
}

// The actor's commitment: the declaration is complete, aimed where it must
// be, affordable, and from here on locked — what everyone else answers is
// exactly this. Nothing is paid yet; that waits for the die. A move writes
// down where it sets out from, since the mover may be stood part of the way
// along it before it resolves.
export function commitAction(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared') return state
    const actor = state.characters[open.actorId]
    if (!actor || !isDeclarationComplete(state, actor, open)) return state
    if (needsTarget(open) && (open.targetId === null || !getTargetIds(state, open).includes(open.targetId))) return state
    if (!getPayableCost(state, open)) return state
    const committed: Action = open.kind === 'move'
      ? { ...open, status: 'committed', from: state.board?.placements[open.actorId] ?? null }
      : { ...open, status: 'committed' }
    return replaceActions(state, [committed])
  }
}

// The reactor's way out of an action their reaction opened, while it is
// still only declared: the action goes, and a root waiting on that
// opportunity attack is handed on to the next. An opportunity attack goes
// with its strike, as if never declared, or the move would open it again; a
// reaction that was paid for (a follow, an evasion) stays on the record.
export function withdrawSpawnedAction(newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared' || !open.spawnedBy) return state
    const reaction = getOpeningReaction(state, open)
    const dropped = reaction ? [open.id, reaction.id] : [open.id]
    const withdrawn = { ...state, actions: state.actions.filter((a) => !dropped.includes(a.id)) }
    const root = reaction ? getRootOf(withdrawn, reaction) : null
    return root?.status === 'rolled' ? advanceOpportunities(withdrawn, root, newId) : withdrawn
  }
}

// A reaction to the committed action (combat.tex "Reactions"), declared
// before the die by anyone the action triggers something in. A character has
// one answer at a time: a new one replaces it.
export function declareReaction(actorId: string, draft: ActionDraft, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || !isAnswerable(state, open)) return state
    if (!canAnswer(open, actorId)) return state
    if (!findOption(state, actorId, draft)?.available) return state
    const trigger = findTrigger(state, open, { kind: draft.kind, actorId, at: 'at' in draft ? draft.at : undefined })
    const reaction = ActionSchema.parse({ ...draft, id: newId(), actorId, targetId: trigger?.against ?? open.actorId, reactionTo: open.id })
    return pruneReactions({ ...state, actions: [...withoutLiveReaction(state, open.id, actorId), reaction] })
  }
}

// Fills in what the reactor's declared reaction still has to say — the
// strike an opportunity attack opens — while the root is still waiting for
// its die. The kind is not a declaration and cannot change.
export function amendReaction(actorId: string, fields: Partial<ActionDraft>): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || !isAnswerable(state, open)) return state
    const reaction = getLiveReactionsTo(state, open.id).find((r) => r.actorId === actorId)
    if (!reaction || (fields.kind !== undefined && fields.kind !== reaction.kind)) return state
    return pruneReactions(replaceActions(state, [ActionSchema.parse({ ...reaction, ...fields, kind: reaction.kind })]))
  }
}

// Takes back a declared reaction: the defender takes the attack on SD, the
// reactor who had chosen an opportunity attack is back to choosing.
export function withdrawReaction(actorId: string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || !isAnswerable(state, open)) return state
    return pruneReactions({ ...state, actions: withoutLiveReaction(state, open.id, actorId) })
  }
}

// One step back: the reaction declared last is taken back, whoever's it was.
export function withdrawLastReaction(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || !isAnswerable(state, open)) return state
    const last = getLiveReactionsTo(state, open.id).at(-1)
    return last ? withdrawReaction(last.actorId)(state) : state
  }
}

// Abandons the open action. Only while declared: the commit is the table's
// word, and from it the action is played out. An action a reaction opened
// is withdrawn instead, so its reaction goes with it.
export function cancelAction(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared' || open.spawnedBy) return state
    return { ...state, actions: state.actions.filter((a) => a.id !== open.id && a.reactionTo !== open.id) }
  }
}

// The dice. Prices the committed action and its reactions off their actors
// as they stand, scores each die against the DL the declarations add up to,
// and takes every price — all in one update, so no state exists in which a
// die is known and the cost is not paid. `dice` is thrown once for the root
// if it is a test, then once per reaction that is a test of its own, in the
// order they were declared. Refused, and nothing happens, when a reaction
// has not said all it must or someone cannot pay what they declared. A
// strike or a shot is scored against the target's defense; a move across
// difficult terrain is a Balance test against the ground (combat.tex
// "Balance"), and pays for the path as the test leaves it; an explosion has
// no test of its own, and each reflex made against it is scored against its
// DL (combat.tex "Avoiding an Explosion").
export function rollAction(dice: Dice, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed' || !needsDie(state, open)) return state
    const actor = state.characters[open.actorId]
    if (!actor || !areReactionsComplete(state, open)) return state

    const rootTest = getRootTest(state, open)
    const test = rootTest ? resolveTest(rootTest, dice) : null
    if (!test && ACTIONS[open.kind].die) return state
    const withRoll: Action = test ? { ...open, roll: test } : open
    return payAll(state, withRoll, newId, (a) => (a.id !== open.id && ACTIONS[a.kind].die ? resolveTest(getReactionTest(state, open, a), dice) : a.roll))
  }
}

// The die's counterpart for a committed action with none (combat.tex
// "Movement": a move is bought, not rolled). Prices it and its reactions off
// their actors as they stand and takes every price, in one update; refused
// when a reaction has not said all it must or someone cannot pay.
export function payAction(newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (open?.kind === 'drag' && open.status === 'rolled' && isAnswerable(state, open)) return fightPush(state, open, newId)
    if (!open || open.status !== 'committed' || needsDie(state, open)) return state
    if (!areReactionsComplete(state, open)) return state
    // combat.tex "Push and drag": the comparison is made as the price is paid
    return payAll(state, open.kind === 'drag' ? { ...open, compared: getDragComparison(state, open) } : open, newId)
  }
}

// Prices the root and every reaction to it off their actors as they stand
// and takes every price in one update: the root is rolled, its reactions
// done. Nothing happens if anyone cannot pay. `rollOf` throws the die of a
// reaction that is a test of its own, in the order they were declared.
function payAll(state: CombatState, root: Action, newId: () => string, rollOf: (a: Action) => ActionRoll | null = (a) => a.roll): CombatState {
  const paid: Action[] = []
  for (const a of [root, ...getReactionsTo(state, root.id)]) {
    const cost = getPayableCost(state, a)
    if (!cost) return state
    paid.push({ ...a, cost, roll: rollOf(a), status: a.id === root.id ? 'rolled' : 'resolved' })
  }
  return afterPaying(applyPhase(replaceActions(state, paid), paid, 'roll'), root.id, newId)
}

// combat.tex "Opportunity Attack": "It is possible to cancel the triggering
// action ... to defend against an opportunity attack" — gives up the action
// the open opportunity attack was drawn by, so its actor can answer with
// anything but the SD, the AP it cost paying towards that defense
// (`getRepurposedAP`). Only that actor, and only against an opportunity
// attack their own action triggered.
export function cancelTriggeringAction(actorId: string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed') return state
    const root = getCancellableRoot(state, open, actorId)
    return root ? replaceActions(state, [{ ...root, cancelled: true, cancelledFor: open.id }]) : state
  }
}

// Lands the rolled action on everyone it concerns and closes it, once
// nothing is left to aim, choose or answer.
export function resolveAction(newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    const step = getNextStep(state)
    if (!open || open.status !== 'rolled' || (step !== 'confirm' && step !== 'spend')) return state
    const resolved = getSettled(state, open)
    const landed = applyPhase(replaceActions(state, [resolved]), [resolved], 'resolve')
    const spawned = appendActions(landed, spawn(landed, resolved, newId))
    return afterLanding(spawned, resolved, newId)
  }
}
