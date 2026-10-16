import { isCombatStarted } from '../rules/started'
import { ActionSchema, type Action, type Coord, type ActionDraft, type CastAction, type SceneState, type FireAgainAction, type MoveAction, type RootAction, type Updater } from '../types'
import type { CampaignCharacter, SurgeKind } from '../../types'
import { SPELLS, isSpellKey } from '../../spells'
import { ACTIONS, isAttackAction, isReaction } from '../rules/actionCatalog'
import { areReactionsComplete, canAffordOpportunity, isPreparedRequired, getClimbRedoCount, getCostTerms, getHoldCost, getNextStep, getDeclaredFloorTargets, getOwnCost, getPayableCost, getRefundedAP, getTargetIds, isDeclarationComplete, isTargetAimed, needsDie, needsOwnDie, needsTarget } from '../rules/action'
import { canAnswer, getLiveReactionsTo, getOpenAction, getOpeningReaction, getReactionsTo } from '../rules/log'
import { detect, getNoise, getStealthTurn } from '../rules/stealth'
import { getReactorDetections } from '../rules/reactions'
import { findOption, getAwaited, hasOpenAnswer } from '../rules/options'
import { getClimbRedoTest, getDefaultAim, getReactionTest, getRootTest } from '../rules/attack'
import { needsBreakRolls } from '../rules/breakage'
import { resolveTest } from '../../play/test'
import { findTrigger } from '../rules/reactions'
import { getMoveTest } from '../rules/move'
import { getClimbDegree } from '../rules/board/cliff'
import { canAfford } from '../../character/rules/cost'
import { moded, rollPercent, type Dice } from '../../play/dice'
import { getDragComparison } from '../rules/drag'
import { getHold } from '../rules/fireAgain'
import { canAcceptSpellTest, getCastGear } from '../rules/cast'
import { withSweepArc } from '../rules/sweep'
import { appendActions, applyPhase, discardDraft, getAnswerableOpen, getOpenAt, pruneReactions, replaceActions, withdrawActions } from './log'
import { advance, land, repositionDefenders } from './sequence'
import { giveUpHeld } from './hold'
import { updateCharacter } from './characters'
import { actionSurge } from '../../character/commands/actionSurge'
import { getTestedIds } from '../rules/tested'

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
    const open = getOpenAt(state, 'define')
    if (!open) return state
    if (fields.kind !== undefined && fields.kind !== open.kind) return state
    return replaceActions(state, [ActionSchema.parse({ ...open, ...fields, kind: open.kind })])
  }
}

// Aims the open action. A part picked on the old target is not one of the
// new target's: the aim goes back to the new target's default. A strike or a
// shot may be aimed at an item on the floor by its id, which leaves it no
// character to aim at.
export function setTarget(targetId: string): Updater {
  return (state) => {
    const open = getOpenAt(state, 'define')
    if (!open) return state
    if (isAttackAction(open) && getDeclaredFloorTargets(state, open).some((f) => f.item.id === targetId)) {
      return replaceActions(state, [{ ...open, targetId: null, object: targetId, cell: null, ...getDefaultAim(undefined) }])
    }
    if (!getTargetIds(state, open).includes(targetId)) return state
    const retargeted = 'part' in open && open.targetId !== targetId ? { ...getDefaultAim(state.characters[targetId]), ...(isAttackAction(open) ? { object: '', cell: null } : {}) } : {}
    return replaceActions(state, [{ ...open, targetId, ...retargeted }])
  }
}

// Aims the open strike or shot at a space of the ground, which leaves it no
// character or item to aim at.
export function aimAtCell(cell: Coord): Updater {
  return (state) => {
    const open = getOpenAt(state, 'define')
    if (!open || !isAttackAction(open)) return state
    return replaceActions(state, [{ ...open, targetId: null, object: '', cell, ...getDefaultAim(undefined) }])
  }
}

// The actor's commitment: the declaration is complete, aimed where it must
// be, affordable, and from here on locked — what everyone else answers is
// exactly this. Nothing is paid yet; that waits for the die. A move writes
// down where it sets out from, since the mover may be stood part of the way
// along it before it resolves; a sweep, who its arc reaches after its target,
// as they stand when it is swung. When nobody has an answer open to it, nothing
// waits between the commit and the die, so it is rolled or paid at once. A
// flee committed as passed up is withdrawn.
export function commitAction(dice: Dice, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAt(state, 'define')
    if (!open) return state
    if (open.kind === 'fleeFollowUp' && !open.flee) return withdrawSpawnedAction(newId)(state)
    const actor = state.characters[open.actorId]
    if (!actor || !isDeclarationComplete(state, actor, open)) return state
    if (needsTarget(open) && !isTargetAimed(state, open)) return state
    const cost = getPayableCost(state, open)
    const hold = cost ? null : getHoldCost(state, open)
    if (!cost && !hold) return state
    // combat.tex "Concentration": what it cannot be paid for, it is held over
    const committed: RootAction = { ...withCommitFacts(state, actor, open, dice), noise: getNoise(state, open, (cost ?? hold)!.AP), holding: hold !== null, step: 'react' }
    const locked = replaceActions(state, [withStealthFacts(state, committed)])
    return hasOpenAnswer(locked) ? locked : rollOrPay(dice, newId)(locked)
  }
}

// combat.tex "Stealth in combat": what the root writes down of who had whom
// as it is committed — the test its actor made of its target, the ones made
// of its actor by whoever it would let answer, and, in its actor's own turn,
// whom they began it undetected by.
function withStealthFacts(state: SceneState, root: RootAction): RootAction {
  const aimed = root.targetId ? detect(state, root.actorId, root.targetId) : null
  const ofTarget = root.targetId && aimed?.test ? [{ observerId: root.actorId, hiderId: root.targetId, ...aimed }] : []
  const turn = getStealthTurn(state)
  return { ...root, detections: [...ofTarget, ...getReactorDetections(state, root)], hiddenFrom: turn?.id === root.actorId ? turn.hiddenFrom : null }
}

// What the root writes down as it is committed, fixed from here on whatever
// moves before it resolves.
function withCommitFacts(state: SceneState, actor: CampaignCharacter, open: RootAction, dice: Dice): RootAction {
  switch (open.kind) {
    case 'move':
      return { ...open, from: state.board?.placements[open.actorId] ?? null }
    case 'strike':
      return withSweepArc(state, open)
    case 'cast':
      return withCastGear(actor, open)
    case 'fireAgain':
      return withHold(state, actor, open, dice)
    case 'shoot':
    case 'explosion':
    case 'blast':
    case 'spellTest':
    case 'fall':
    case 'swimTest':
    case 'grapple':
    case 'drag':
    case 'release':
    case 'slip':
    case 'feint':
    case 'cut':
    case 'holdBack':
    case 'pickUp':
    case 'throw':
    case 'extinguish':
    case 'drink':
    case 'firstAid':
    case 'cauterize':
    case 'reload':
    case 'social':
    case 'taunt':
    case 'rest':
    case 'prepare':
    case 'fleeFollowUp':
      return open
  }
}

// What the table does once nobody owes the committed action an answer: throws
// its die, or pays it where it has none.
export function rollOrPay(dice: Dice, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAt(state, 'react')
    return open && needsDie(state, open) ? rollAction(dice, newId)(state) : payAction(newId, dice)(state)
  }
}

// gear.tex "Equipment Breakage": the percentile thrown for the armor each
// character wears, with the action whose effects reach several of them — a
// cast, an explosion, a spray fired again — when it is rolled or paid. None
// when the fight has no breakage, so the dice are not touched.
function withArmorRolls<A extends RootAction>(state: SceneState, root: A, dice: Dice): A {
  if (!state.breakage || (root.kind !== 'cast' && root.kind !== 'explosion' && root.kind !== 'fireAgain')) return root
  return { ...root, armorRolls: Object.fromEntries(Object.keys(state.characters).map((id) => [id, rollPercent(dice)])) }
}

// spells.tex "Requirements": the gear the cast is made with and the object
// a charge goes into, named once it is committed, so the cast keeps them
// after it spends what it draws from them.
function withCastGear(actor: CampaignCharacter, open: CastAction): CastAction {
  const { itemId, chargeItemId } = getCastGear(actor, open)
  return { ...open, itemId, chargeItemId }
}

// What a held spell fired again is fired with, named once it is committed:
// the item and size it is held at, the target it is bound to, and the
// percentile die for a fraction of a charge.
function withHold(state: SceneState, actor: CampaignCharacter, open: FireAgainAction, dice: Dice): FireAgainAction {
  if (!isSpellKey(open.key)) return open
  const draws = (SPELLS[open.key].repeat?.ammo ?? 0) > 0
  return { ...open, ...getHold(state, actor, open.key), chargeRoll: draws ? rollPercent(dice) : 0 }
}

// The actor's way out of an action another opened for them, while it is
// still only declared, and the fight carries on from the action beneath. An
// opportunity attack goes with its strike, as if never declared, or the
// root would open it again. For anything else the journal's entry is what
// keeps the offer from being made twice; the reaction that opened it (a
// follow, an evasion, a reflex against a blast) was paid for and stays on the
// record.
// What a prepared reaction opened is passed up only as the book allows
// (`isPreparedRequired`).
export function withdrawSpawnedAction(newId: () => string): Updater {
  return (state) => {
    const open = getOpenAt(state, 'define')
    if (!open || !open.spawnedBy || isPreparedRequired(state, open)) return state
    const reaction = getOpeningReaction(state, open)
    return advance(withdrawActions(state, reaction ? [open.id, reaction.id] : [open.id], 'passedUp'), newId)
  }
}

// A reaction to the committed action (combat.tex "Reactions"), declared
// before the die by anyone the action triggers something in. A character has
// one answer at a time: a new one replaces it.
export function declareReaction(actorId: string, draft: ActionDraft, newId: () => string): Updater {
  return (state) => {
    const open = getAnswerableOpen(state)
    if (!open) return state
    if (!canAnswer(open, actorId)) return state
    const chosen = findOption(state, actorId, draft)
    if (!chosen?.available) return state
    const trigger = findTrigger(state, open, { kind: draft.kind, actorId, at: 'at' in draft ? draft.at : undefined, preparedId: 'preparedId' in draft ? draft.preparedId : undefined })
    const targetId = trigger?.against ?? open.actorId
    const parsed = ActionSchema.parse({ ...draft, id: newId(), actorId, targetId, reactionTo: open.id, recipe: trigger?.recipe ?? null })
    const aimed = 'part' in parsed && !('location' in draft) ? { ...parsed, ...getDefaultAim(state.characters[targetId]) } : parsed
    const paid = chosen.surge ? updateCharacter(actorId, actionSurge(chosen.surge), `${chosen.surge} surge for a reaction`)(state) : state
    const reaction = { ...aimed, surged: getSurgeMade(state, paid, actorId, chosen.surge) }
    const replaced = getLiveReactionsTo(paid, open.id).filter((r) => r.actorId === actorId)
    return pruneReactions(appendActions(withdrawActions(paid, replaced.map((r) => r.id), 'replaced'), [reaction]))
  }
}

// What the surge took from the actor and gave them, off the two fights; null
// when none was made or it was not open to them.
function getSurgeMade(before: SceneState, after: SceneState, actorId: string, kind: SurgeKind | null | undefined): Action['surged'] {
  const was = before.characters[actorId]
  const now = after.characters[actorId]
  if (!kind || !was || !now || (was.resources.STA === now.resources.STA && was.surgeFloor === now.surgeFloor && was.resources.AP === now.resources.AP)) return null
  return { kind, STA: was.resources.STA - now.resources.STA, AP: now.resources.AP - was.resources.AP }
}

// Fills in what the reactor's declared reaction still has to say — the
// strike an opportunity attack opens — while the root is still waiting for
// its die. The kind is not a declaration and cannot change.
export function amendReaction(actorId: string, fields: Partial<ActionDraft>): Updater {
  return (state) => {
    const open = getAnswerableOpen(state)
    if (!open) return state
    const reaction = getLiveReactionsTo(state, open.id).find((r) => r.actorId === actorId)
    if (!reaction || (fields.kind !== undefined && fields.kind !== reaction.kind)) return state
    const amended = ActionSchema.parse({ ...reaction, ...fields, kind: reaction.kind })
    const next = pruneReactions(replaceActions(state, [amended]))
    return amended.kind === 'opportunityAttack' && !canAffordOpportunity(next, amended) ? state : next
  }
}

// Takes back a declared reaction: the defender takes the attack on SD, the
// reactor who had chosen an opportunity attack is back to choosing.
export function withdrawReaction(actorId: string): Updater {
  return (state) => {
    const open = getAnswerableOpen(state)
    if (!open) return state
    const taken = getLiveReactionsTo(state, open.id).filter((r) => r.actorId === actorId)
    return pruneReactions(withdrawActions(state, taken.map((r) => r.id), 'tookBack'))
  }
}

// The reactor answers the committed action with nothing: whatever they had
// declared is taken back, and the action no longer waits on them. Refused for
// anyone it neither waits on nor has an answer from.
export function passReaction(actorId: string): Updater {
  return (state) => {
    const open = getAnswerableOpen(state)
    if (!open) return state
    const taken = getLiveReactionsTo(state, open.id).filter((r) => r.actorId === actorId)
    if (!taken.length && !getAwaited(state).includes(actorId)) return state
    const withdrawn = taken.length ? pruneReactions(withdrawActions(state, taken.map((r) => r.id), 'tookBack')) : state
    const root = getAnswerableOpen(withdrawn)
    return root && !root.passed.includes(actorId) ? replaceActions(withdrawn, [{ ...root, passed: [...root.passed, actorId] }]) : withdrawn
  }
}

// The die, the payment and a willing target's acceptance as the table
// presses them: refused while the committed action still waits on anyone
// (`getAwaited`) but the one accepting.
export function rollAnswered(dice: Dice, newId: () => string): Updater {
  return (state) => (getAwaited(state).length ? state : rollAction(dice, newId)(state))
}

export function payAnswered(newId: () => string, dice: Dice): Updater {
  return (state) => (getAwaited(state).length ? state : payAction(newId, dice)(state))
}

export function acceptAnswered(newId: () => string): Updater {
  return (state) => (getAwaited(state).some((id) => id !== getOpenAction(state)?.targetId) ? state : acceptSpellTest(newId)(state))
}

// combat.tex "Push and drag": the pusher's "spend 2 AP to gain 5 force",
// said while the push is declared or once the grapple has answered — "the
// losing side must decide first", so it counts only when the pusher's side
// is the one the comparison goes against at its turn to decide
// (rules/drag.ts).
export function boostPush(boost: boolean): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (open?.kind !== 'drag' || (open.step !== 'define' && open.step !== 'react')) return state
    return replaceActions(state, [{ ...open, boost }])
  }
}

// One step back: the reaction declared last is taken back, whoever's it was.
export function withdrawLastReaction(): Updater {
  return (state) => {
    const open = getAnswerableOpen(state)
    if (!open) return state
    const last = getLiveReactionsTo(state, open.id).at(-1)
    return last ? withdrawReaction(last.actorId)(state) : state
  }
}

// Abandons the open action. Only while declared: the commit is the table's
// word, and from it the action is played out. An action a reaction opened
// is withdrawn instead, so its reaction goes with it.
export function cancelAction(): Updater {
  return (state) => {
    const open = getOpenAt(state, 'define')
    if (!open || open.spawnedBy) return state
    return discardDraft(state, open.id)
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
  return (given) => {
    const attacked = getOpenAt(given, 'react')
    const placed = attacked?.kind === 'strike' || attacked?.kind === 'shoot' ? repositionDefenders(given, attacked, newId) : { state: given, waiting: false }
    if (placed.waiting) return placed.state
    const state = placed.state
    const open = getOpenAt(state, 'react')
    if (!open || !needsDie(state, open)) return state
    const actor = state.characters[open.actorId]
    if (!actor || !areReactionsComplete(state, open)) return state

    const rootTest = getRootTest(state, open)
    const rootDice = open.kind === 'move' ? moded(open.mode, dice) : dice
    const own = open.kind !== 'move' || needsOwnDie(state, open)
    const test = rootTest && own ? resolveTest(rootTest, rootDice) : null
    if (!test && own && ACTIONS[open.kind].die) return state
    const thrown = withTargetDice(withArmorRolls(state, withPercentileRolls(state, test ? { ...open, roll: test } : open, dice), dice), dice)
    const rolled = thrown.kind === 'move' && open.kind === 'move' ? withClimbGiveUp(state, withClimbRolls(state, { ...thrown, test: test ? getMoveTest(state, open) : null }, rootDice)) : thrown
    return payAll(state, rolled, newId, (a) => (a.id !== open.id && ACTIONS[a.kind].die ? withTargetDice({ ...a, roll: resolveTest(getReactionTest(state, open, a), dice) }, dice) : a))
  }
}

// combat.tex "Climbing": the test each attack drawn against the climb would
// have the climber make if it interrupted them, a fresh one for each, thrown
// with the climb's own and used only if the attack comes.
function withClimbRolls(state: SceneState, move: MoveAction, dice: Dice): MoveAction {
  const test = getClimbRedoTest(state, move)
  return test ? { ...move, redos: Array.from({ length: getClimbRedoCount(state, move) }, () => resolveTest(test, dice)) } : move
}

// combat.tex "Climbing": "On a graze, decide to go at 2AP+1STA or give up and
// fall" — a climber who cannot pay for going on gives up.
function withClimbGiveUp(state: SceneState, move: MoveAction): MoveAction {
  const actor = state.characters[move.actorId]
  const cost = move.movement === 'climb' && getClimbDegree(state, move) === 'graze' ? getOwnCost(state, move) : null
  return actor && cost && !canAfford(actor, cost, isCombatStarted(state)) ? { ...move, gaveUp: true } : move
}

// The die each one the action may deliver a test to throws with it, right
// after its own, read when it lands (rules/tested.ts).
function withTargetDice<A extends Action>(root: A, dice: Dice): A {
  const ids = getTestedIds(root)
  return ids.length > 0 ? { ...root, targetDice: Object.fromEntries(ids.map((id) => [id, dice(false)])) } : root
}

// The percentile dice thrown with the root's test, after it and before any
// reaction's.
function withPercentileRolls(state: SceneState, root: RootAction, dice: Dice): RootAction {
  switch (root.kind) {
    // spells.tex "Amplify Spell": the percentile die for a fraction of a
    // charge, thrown with the cast
    case 'cast':
      return isSpellKey(root.key) && SPELLS[root.key].ammo > 0 ? { ...root, chargeRoll: rollPercent(dice) } : root
    case 'cut':
      return { ...root, breakRoll: rollPercent(dice) }
    case 'strike':
    case 'shoot':
      return needsBreakRolls(state, root) ? { ...root, breakRolls: { defender: rollPercent(dice), attacker: rollPercent(dice), armor: rollPercent(dice), object: rollPercent(dice) } } : root
    case 'explosion':
    case 'blast':
    case 'fireAgain':
    case 'spellTest':
    case 'fall':
    case 'swimTest':
    case 'move':
    case 'grapple':
    case 'drag':
    case 'release':
    case 'slip':
    case 'feint':
    case 'holdBack':
    case 'pickUp':
    case 'throw':
    case 'extinguish':
    case 'drink':
    case 'firstAid':
    case 'cauterize':
    case 'reload':
    case 'social':
    case 'taunt':
    case 'rest':
    case 'prepare':
    case 'fleeFollowUp':
      return root
  }
}

// The die's counterpart for a committed action with none (combat.tex
// "Movement": a move is bought, not rolled). Prices it and its reactions off
// their actors as they stand and takes every price, in one update; refused
// when a reaction has not said all it must or someone cannot pay.
export function payAction(newId: () => string, dice: Dice): Updater {
  return (state) => {
    const open = getOpenAt(state, 'react')
    if (!open || needsDie(state, open)) return state
    if (!areReactionsComplete(state, open)) return state
    // combat.tex "Push and drag": the comparison is made as the price is paid
    if (open.holding) return payAll(state, open, newId)
    return payAll(state, open.kind === 'drag' ? { ...open, compared: getDragComparison(state, open) } : open.kind === 'move' ? withClimbGiveUp(state, open) : withTargetDice(withArmorRolls(state, open, dice), dice), newId)
  }
}

// spells.tex "Telepathic Link": a willing target takes the spell's test
// without a die, as if they had missed it, and it lands.
export function acceptSpellTest(newId: () => string): Updater {
  return (state) => {
    const open = getOpenAt(state, 'react')
    if (!open || open.kind !== 'spellTest' || !canAcceptSpellTest(open)) return state
    return payAll(state, { ...open, accepted: true }, newId)
  }
}

// Prices the root and every reaction to it off their actors as they stand
// and takes every price in one update: the root is rolled, its reactions
// done. Nothing happens if anyone cannot pay. `rollOf` throws the die of a
// reaction that is a test of its own, in the order they were declared.
function payAll(state: SceneState, root: Action, newId: () => string, thrown: (a: Action) => Action = (a) => a): SceneState {
  const paid: Action[] = []
  for (const a of [root, ...getReactionsTo(state, root.id)]) {
    const cost = getPayableCost(state, a)
    if (!cost) return state
    paid.push({ ...thrown(a), cost, costTerms: getCostTerms(state, a) ?? [], refunded: a.reactionTo ? getRefundedAP(state, a.actorId, a.reactionTo) : 0, step: a.id === root.id ? 'post' : 'done' })
  }
  return advance(giveUpHeld(applyPhase(replaceActions(state, paid), paid, 'roll'), paid), newId)
}

// Lands the rolled action on everyone it concerns and closes it, once
// nothing is left to aim, choose or answer.
export function resolveAction(newId: () => string): Updater {
  return (state) => {
    const open = getOpenAt(state, 'post')
    const step = getNextStep(state)
    if (!open || (step !== 'confirm' && step !== 'spend')) return state
    return land(state, open, newId)
  }
}

// The spell the cast being declared is of, on the focus surge or quickened
// without it; the gear picked for another spell is not this one's. A cast being
// prepared names the spell the same way, and the gear when it is made.
export function chooseSpell(key: string, quicken: boolean): Updater {
  return (state) => {
    const open = getOpenAt(state, 'define')
    if (open?.kind === 'prepare' && open.main === 'cast') return amendAction({ key, quicken })(state)
    if (open?.kind !== 'cast') return state
    const same = key === open.key
    return amendAction({ key, quicken, itemId: same ? open.itemId : '', chargeItemId: same ? open.chargeItemId : '' })(state)
  }
}

// spells.tex "Extend Spell": one extension more or fewer on the cast being
// declared, never fewer than none.
export function stepExtend(delta: 1 | -1): Updater {
  return (state) => {
    const open = getOpenAt(state, 'define')
    if (open?.kind !== 'cast' && !(open?.kind === 'prepare' && open.main === 'cast')) return state
    const extend = Math.max(0, open.extend + delta)
    return extend === open.extend ? state : amendAction({ extend })(state)
  }
}
