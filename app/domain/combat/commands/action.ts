import type { CampaignCharacter, Delivery } from '../../types'
import { ActionSchema, DirectionSchema, type Action, type ActionDraft, type AttackAction, type ActionRoll, type CombatState, type Updater, type Coord, type DragAction, type TriggeringAction, type ExplosionAction, type HOPPurchase, type Interruption, type MoveAction } from '../types'
import { ACTIONS, isReaction } from '../rules/actionCatalog'
import { areReactionsComplete, getAction, getDeclaredCost, getNextStep, getOpenAction, getReactionsTo, getRootOf, getTargetIds, isAnswerable, isDeclarationComplete, needsDie, needsTarget } from '../rules/action'
import { findOption } from '../rules/options'
import { canSaveGraze, getCastFacts, getGrazeSavedRoll, getImprovementOptions } from '../rules/cast'
import { getOpportunityAction, getReactionTest, getRootTest } from '../rules/attack'
import { resolveTest } from '../rules/test'
import { getTriggersFor } from '../rules/reactions'
import type { Dice } from '../dice'
import { getAttackFacts, getHOPOptions, getStrikeTrample, isTripped, outcomeOf } from '../rules/damage'
import { getExplosionFacts, isSpray } from '../rules/explosion'
import { getMoveFacts, getMoveOverride, getMovePrice, getMoveWaypoint, getOpportunityAttacks } from '../rules/move'
import { getDistanceBetween, getMeleeRange } from '../rules/board'
import { reduceBoard, reduceCharacter, reduceFloor, reduceGrapples, type Phase } from './reduce'
import { getCancellableRoot, getDrawnOpportunityAttacks, isCancelled, isTriggeringAction } from '../rules/opportunity'
import { getCircleCells, getDragChoices, getDragFacts, getDragOutcome, getGrabFacts, getHoldBackFacts, getManeuverFacts, getPartner, getReleaseFacts, holds } from '../rules/grapple'
import { sameCell } from '../geometry'
import { getReachableFloor } from '../rules/floor'
import { settleGrapples } from './grapple'
import { SPELLS, isSpellKey } from '../../spells'
import type { SpellModification } from '../../tables'
import { ActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { MOVEMENT_KINDS } from '../../lists'

// The phases of an action, as commands. Everything up to the roll only edits
// the action record and is free to undo: the declaration is edited, then
// `commitAction` locks it so its triggers can be loaded and answered;
// `rollAction` (or `payAction`, for an action with no die) throws the die and
// takes the price in one update, and from there the only way forward is
// `resolveAction`. Every command returns the state unchanged when asked for
// something the phase does not allow, so the store can dispatch blindly.

function replaceActions(state: CombatState, next: Action[]): CombatState {
  return { ...state, actions: state.actions.map((a) => next.find((n) => n.id === a.id) ?? a) }
}

function mapCharacters(state: CombatState, f: (c: CampaignCharacter) => CampaignCharacter): CombatState {
  return { ...state, characters: Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, f(c)])) }
}

// A cancelled action lands nothing at its resolve (combat.tex
// "Interruption"); its price was already taken at the roll.
function applyPhase(state: CombatState, actions: Action[], phase: Phase): CombatState {
  return actions.reduce((s, action) => {
    if (phase === 'resolve' && isTriggeringAction(action) && action.cancelled) return s
    const next = mapCharacters(s, reduceCharacter(action, phase))
    const grappled = { ...next, floor: reduceFloor(s, action, phase)(s.floor), grapples: reduceGrapples(action, phase)(next.grapples) }
    const placed = grappled.board ? { ...grappled, board: reduceBoard(next, action, phase)(grappled.board) } : grappled
    return settleGrapples(s.grapples)(placed)
  }, state)
}

// Opens an action for a character. One at a time: nothing can be declared
// while another action is still being played out. Refuses exactly what the
// character's action list shows as closed.
export function declareAction(actorId: string, draft: ActionDraft, newId: () => string): Updater {
  return (state) => {
    if (getOpenAction(state) || isReaction(draft.kind)) return state
    if (!findOption(state, actorId, draft)?.available) return state
    const action = ActionSchema.parse({ ...draft, id: newId(), actorId })
    return { ...state, actions: [...state.actions, action] }
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
    if (!priceFor(state, open)) return state
    const committed: Action = open.kind === 'move'
      ? { ...open, status: 'committed', from: state.board?.placements[open.actorId] ?? null }
      : { ...open, status: 'committed' }
    return replaceActions(state, [committed])
  }
}

// The reactor's way out of an action their reaction opened, while it is
// still only declared: the action goes, and a move waiting on that
// opportunity attack is handed on to the next. An opportunity attack goes
// with its strike, as if never declared, or the move would open it again; a
// reaction that was paid for (a follow, an evasion) stays on the record.
export function withdrawSpawnedAction(newId: () => string = () => `${Date.now()}`): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared' || !open.spawnedBy) return state
    const reaction = getAction(state, open.spawnedBy)
    const dropped = reaction?.kind === 'opportunityAttack' ? [open.id, reaction.id] : [open.id]
    const withdrawn = { ...state, actions: state.actions.filter((a) => !dropped.includes(a.id)) }
    const root = reaction ? getRootOf(withdrawn, reaction) : null
    return root?.kind === 'move' && root.status === 'rolled' ? advanceMove(withdrawn, root, newId) : withdrawn
  }
}

// A reaction to the committed action (combat.tex "Reactions"), declared
// before the die by anyone the action triggers something in. A character has
// one answer at a time: a new one replaces it.
export function declareReaction(actorId: string, draft: ActionDraft, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || !isAnswerable(state, open)) return state
    if (open.actorId === actorId && open.kind !== 'explosion') return state
    if (!findOption(state, actorId, draft)?.available) return state
    const trigger = getTriggersFor(state, open, actorId).find((t) => t.kind === draft.kind && t.at === ((draft as { at?: number | null }).at ?? t.at))
    const reaction = ActionSchema.parse({ ...draft, id: newId(), actorId, targetId: trigger?.against ?? open.actorId, reactionTo: open.id })
    return pruneReactions({
      ...state,
      actions: [...state.actions.filter((a) => !(a.reactionTo === open.id && a.actorId === actorId && a.status !== 'resolved')), reaction],
    })
  }
}

// Drops every reaction to the open action that its triggers no longer
// offer: what a push moves someone into depends on the way it is pointed,
// so a third party's opportunity attack goes when the way changes
// (combat.tex "Push and drag").
function pruneReactions(state: CombatState): CombatState {
  const open = getOpenAction(state)
  if (!open || !(open.status === 'committed' || (open.kind === 'drag' && open.status === 'rolled' && !open.fought))) return state
  const kept = state.actions.filter((a) => a.reactionTo !== open.id || a.status === 'resolved' || getTriggersFor(state, open, a.actorId).some((t) =>
    t.kind === a.kind && (a.kind !== 'opportunityAttack' || (t.at === a.at && (t.against ?? open.actorId) === a.targetId))))
  return kept.length === state.actions.length ? state : { ...state, actions: kept }
}

// Fills in what the reactor's declared reaction still has to say — the
// strike an opportunity attack opens — while the root is still waiting for
// its die. The kind is not a declaration and cannot change.
export function amendReaction(actorId: string, fields: Partial<ActionDraft>): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || !isAnswerable(state, open)) return state
    const reaction = getReactionsTo(state, open.id).find((r) => r.actorId === actorId && r.status !== 'resolved')
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
    return pruneReactions({ ...state, actions: state.actions.filter((a) => !(a.reactionTo === open.id && a.actorId === actorId && a.status !== 'resolved')) })
  }
}

// One step back: the reaction declared last is taken back, whoever's it was.
export function withdrawLastReaction(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || !isAnswerable(state, open)) return state
    const last = getReactionsTo(state, open.id).filter((r) => r.status !== 'resolved').at(-1)
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
export function rollAction(dice: Dice, newId: () => string = () => `${Date.now()}`): Updater {
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
export function payAction(newId: () => string = () => `${Date.now()}`): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (open?.kind === 'drag' && open.status === 'rolled' && isAnswerable(state, open)) return fightPush(state, open, newId)
    if (!open || open.status !== 'committed' || needsDie(state, open)) return state
    if (!areReactionsComplete(state, open)) return state
    return payAll(state, open, newId)
  }
}

// Prices the root and every reaction to it off their actors as they stand
// and takes every price in one update: the root is rolled, its reactions
// done. Nothing happens if anyone cannot pay. `rollOf` throws the die of a
// reaction that is a test of its own, in the order they were declared.
function payAll(state: CombatState, root: Action, newId: () => string, rollOf: (a: Action) => ActionRoll | null = (a) => a.roll): CombatState {
  const paid: Action[] = []
  for (const a of [root, ...getReactionsTo(state, root.id)]) {
    const cost = priceFor(state, a)
    if (!cost) return state
    paid.push({ ...a, cost, roll: rollOf(a), status: a.id === root.id ? 'rolled' : 'resolved' })
  }
  return afterPaying(applyPhase(replaceActions(state, paid), paid, 'roll'), root.id, newId)
}

// combat.tex "Push and drag": the way pointed and answered, the attacks it
// drew from third parties are opened, one after another, before it lands.
// They were paid for by nobody yet: each opens a strike that is.
function fightPush(state: CombatState, open: DragAction, newId: () => string): CombatState {
  if (!areReactionsComplete(state, open)) return state
  const live = getReactionsTo(state, open.id).filter((r) => r.status !== 'resolved')
  const fought = replaceActions(state, [{ ...open, fought: true }, ...live.map((r): Action => ({ ...r, status: 'resolved' }))])
  return advanceTriggering(fought, { ...open, fought: true }, newId)
}

// The winner's way for the push, once the grapple has answered: push along
// a direction and how far, circle round to a cell, or stay. Only what the
// outcome leaves open; third parties' answers to a way no longer taken go.
export function aimPush(fields: { choice?: 'push' | 'circle' | 'stay'; direction?: number; steps?: number; to?: Coord }): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.kind !== 'drag' || open.status !== 'rolled' || open.fought) return state
    const outcome = getDragOutcome(state, open)
    const choice = fields.choice ?? open.choice
    if (!outcome || !choice || !getDragChoices(state, open).find((c) => c.choice === choice)?.available) return state
    const changed = choice !== open.choice
    const next: DragAction = {
      ...open,
      choice,
      direction: choice !== 'push' ? null : fields.direction ?? (changed ? null : open.direction),
      steps: Math.max(1, Math.min(fields.steps ?? open.steps, outcome.push || 1)),
      to: choice !== 'circle' ? null : fields.to ?? (changed ? null : open.to),
    }
    if (next.to && !getCircleCells(state, next).some((c) => sameCell(c.cell, next.to!))) return state
    return pruneReactions(replaceActions(state, [next]))
  }
}

// What follows the payment: a move, or an action that drew opportunity
// attacks, has the first of them opened before it resolves.
function afterPaying(state: CombatState, id: string, newId: () => string): CombatState {
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
  if (next) return { ...state, actions: [...state.actions, getOpportunityAction(state, next.reaction, newId())] }
  if (root.kind === 'explosion' && !isCancelled(state, root)) return { ...state, actions: [...state.actions, ...escapesBefore(state, root, newId)] }
  return state
}

// combat.tex "Opportunity Attack": "It is possible to cancel the triggering
// action ... to defend against an opportunity attack" — gives up the action
// the open opportunity attack was drawn by, so its actor can answer with
// anything but the SD. Only that actor, and only against an opportunity
// attack their own action triggered.
export function cancelTriggeringAction(actorId: string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed') return state
    const root = getCancellableRoot(state, open, actorId)
    return root ? replaceActions(state, [{ ...root, cancelled: true }]) : state
  }
}

// combat.tex "Avoiding an Explosion": "On a critical, the character can run
// by spending one extra STA. On a hit, they can spend an extra STA to jump
// in any direction before the explosion occurs. On a graze, they can move 1
// AP before the explosion." Each degree unlocks what a lesser one would have
// too, so a critical can still take a graze's plain move instead of paying
// to run — the moves that opens, one per reactor whose test came to that,
// played out ahead of the blast; the reaction's AP buys the move, as an
// evasion's does, and the run's extra STA is on top, the jump's the jump's
// own (combat.tex "Movement Costs and Speeds" prices a jump in STA already).
// A miss moves after it instead, and is opened when the blast has landed —
// its own tier, not cascaded into these, since it happens on the far side.
function escapesBefore(state: CombatState, root: ExplosionAction, newId: () => string): Action[] {
  return getReactionsTo(state, root.id).flatMap((reaction): Action[] => {
    if (reaction.kind !== 'avoidExplosion' || !reaction.roll) return []
    const AP = reaction.cost?.AP ?? 0
    const notRun = MOVEMENT_KINDS.filter((k) => k !== 'run')
    switch (reaction.roll.degree) {
      case 'critical': return [openMove(reaction, newId, { budget: AP, prepaid: AP, movement: 'run', movements: [...MOVEMENT_KINDS], surchargedMovements: ['run'], surcharge: { AP: 0, STA: 1 } })]
      case 'hit': return [openMove(reaction, newId, { budget: AP, prepaid: AP, movement: 'jump', movements: notRun })]
      case 'graze': return [openMove(reaction, newId, { budget: 1, prepaid: AP })]
      default: return []
    }
  })
}

// A move a reaction opens for its reactor: `budget` the most AP it may
// cost, `prepaid` what the reaction already paid towards it.
function openMove(reaction: Action, newId: () => string, fields: Partial<Omit<MoveAction, 'kind'>>): MoveAction {
  return ActionSchema.parse({ ...fields, kind: 'move', id: newId(), actorId: reaction.actorId, spawnedBy: reaction.id }) as MoveAction
}

// combat.tex "Opportunity Attack": "The attack occurs before the effect of
// the triggering action." The mover is walked as far as one space short of
// the stretch the next opportunity attack fires on and the attack is opened
// as a strike of its own; once it lands the move is advanced again, to the
// next one or, if it interrupted, nowhere. One whose stretch the mover never
// reaches — a fall came first — opens nothing.
function advanceMove(state: CombatState, move: MoveAction, newId: () => string): CombatState {
  if (getMoveOverride(state, move) !== null) return state
  const walked = getMoveFacts(state, move).path.length
  const next = getOpportunityAttacks(state, move).find(({ spawned }) => spawned === null)
  // a catch is fought where the runner already stands, so one on the last
  // step still comes (combat.tex "Catch")
  const catching = next?.reaction.grab && move.movement === 'run' ? 1 : 0
  if (!next || next.reaction.at! - catching > walked) return state
  const strike = getOpportunityAction(state, next.reaction, newId())
  const waypoint = getMoveWaypoint(state, move, next.reaction.at! - 1)
  const board = state.board && waypoint ? { ...state.board, placements: { ...state.board.placements, [move.actorId]: waypoint } } : state.board
  return { ...state, board, actions: [...state.actions, strike] }
}

// What the action costs its actor now, or null if they cannot pay it. A
// move pays for the path as it will be walked, cut wherever it will stop.
function priceFor(state: CombatState, action: Action): ActionCost | null {
  const c = state.characters[action.actorId]
  if (!c) return null
  const cost = action.kind === 'move'
    ? getMovePrice(c, action, getMoveFacts(state, action).path.length)
    : getDeclaredCost(c, action)
  if (!cost || !canAfford(c, cost)) return null
  return cost
}

// combat.tex "Success Overflow": buys one effect out of the hit's HOP. Only
// what the option list offers as open, so the command refuses exactly what
// the button shows as closed.
export function spendHOP(purchase: HOPPurchase): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || (open.kind !== 'strike' && open.kind !== 'shoot') || open.status !== 'rolled') return state
    if (!getHOPOptions(state, open).find((o) => o.purchase === purchase)?.available) return state
    return replaceActions(state, [{ ...open, spent: addOne(open.spent, purchase) }])
  }
}

// Takes one purchase back. Nothing has landed on the target until the
// action resolves, so the overflow is free to re-spend up to that point.
export function refundHOP(purchase: HOPPurchase): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || (open.kind !== 'strike' && open.kind !== 'shoot') || open.status !== 'rolled') return state
    const spent = takeOne(open.spent, purchase)
    return spent ? replaceActions(state, [{ ...open, spent }]) : state
  }
}

// A tally of purchases, one more of `key`.
function addOne<K extends string>(tally: Partial<Record<K, number>>, key: K): Partial<Record<K, number>> {
  return { ...tally, [key]: (tally[key] ?? 0) + 1 }
}

// One fewer, the key gone at none; null when there is none to take back.
function takeOne<K extends string>(tally: Partial<Record<K, number>>, key: K): Partial<Record<K, number>> | null {
  const bought = tally[key] ?? 0
  if (bought === 0) return null
  const rest: Partial<Record<K, number>> = { ...tally }
  delete rest[key]
  return bought > 1 ? { ...rest, [key]: bought - 1 } : rest
}

// Points a rolled spray where the attacker chooses, now that the reactions
// have moved (combat.tex "Sprays": "The attacker can choose the exact
// direction of the cone after the movement").
export function aimExplosion(direction: number): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.kind !== 'explosion' || open.status !== 'rolled') return state
    if (!isSpray(state, open) || !DirectionSchema.safeParse(direction).success) return state
    return replaceActions(state, [{ ...open, direction }])
  }
}

// combat.tex "Grapple Maneuvers": what a maneuver's hit is made of, the
// attacker's call once the die is known — committing themselves along
// ("throw oneself along", "stay immobilized yourself") and what a disarm
// goes for. Nothing has landed until the maneuver resolves.
export function chooseManeuver(fields: { along?: boolean; item?: string }): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.kind !== 'grapple' || open.status !== 'rolled') return state
    return replaceActions(state, [{ ...open, along: fields.along ?? open.along, item: fields.item ?? open.item }])
  }
}

// spells.tex "Spell Improvements": buys one improvement out of the cast's
// SOPs, only what the option list offers as open.
export function improveSpell(name: SpellModification): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.kind !== 'cast' || open.status !== 'rolled') return state
    if (!getImprovementOptions(state, open).find((o) => o.name === name)?.available) return state
    return replaceActions(state, [{ ...open, improved: addOne(open.improved, name) }])
  }
}

// spells.tex "Casting spells": raises the grazed cast to the hit the +3
// makes of it and takes the 2 AP it costs, once. Nothing to take back: the
// price is paid as it is bought.
export function saveGraze(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.kind !== 'cast' || !open.roll || !canSaveGraze(state, open)) return state
    const saved: Action = { ...open, grazeSaved: true, roll: getGrazeSavedRoll(open.roll) }
    return applyPhase(replaceActions(state, [saved]), [saved], 'save')
  }
}

// Takes one improvement back, while nothing has been produced yet.
export function refundImprovement(name: SpellModification): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.kind !== 'cast' || open.status !== 'rolled') return state
    const improved = takeOne(open.improved, name)
    return improved ? replaceActions(state, [{ ...open, improved }]) : state
  }
}

// Lands the rolled action on everyone it concerns and closes it, once
// nothing is left to aim, choose or answer.
export function resolveAction(newId: () => string = () => `${Date.now()}`): Updater {
  return (state) => {
    const open = getOpenAction(state)
    const step = getNextStep(state)
    if (!open || open.status !== 'rolled' || (step !== 'confirm' && step !== 'spend')) return state
    const resolved = settle(state, open)
    const landed = applyPhase(replaceActions(state, [resolved]), [resolved], 'resolve')
    const spawned = { ...landed, actions: [...landed.actions, ...spawn(landed, resolved, newId)] }
    return afterLanding(spawned, resolved, newId)
  }
}

// The rolled action as it lands: closed, with what it came to written down
// per kind, read off the state as it stands. A cancelled one comes to
// nothing. A strike or a shot has its attacker's side written down, so the
// record says what landed and the target's reducer needs nothing but the
// action, and what it did to the target's own action beside it, for the
// move it may have cut short or the one an evasion may open. An explosion
// writes down what reaches everyone in its area as the board stands, once
// every escape has been played out and it is pointed where it goes off.
function settle(state: CombatState, open: Action): Action {
  if (isTriggeringAction(open) && isCancelled(state, open)) return { ...open, status: 'resolved', cancelled: true }
  switch (open.kind) {
    case 'strike': {
      const facts = getAttackFacts(state, open)
      const interruption = getInterruption(state, open, facts)
      // combat.tex "Initiate the Grab": "On a hit, the opponent is
      // grappled, and any movement initiated by them is stopped"
      // combat.tex "Catch": "If the target is stopped, the catcher can
      // decide to grapple them without further tests"
      const trample = getStrikeTrample(state, open)
      const grabbed = open.catch && trample?.result !== 'stopped' ? null : getGrabFacts(state, open)
      return { ...open, status: 'resolved', facts, interruption: grabbed && interruption === 'none' ? 'interrupted' : interruption, tripped: isTripped(state, open), trample, grabbed }
    }
    case 'shoot': {
      const facts = getAttackFacts(state, open)
      return { ...open, status: 'resolved', facts, interruption: getInterruption(state, open, facts) }
    }
    case 'grapple': return { ...open, status: 'resolved', facts: getManeuverFacts(state, open) }
    case 'pickUp': return { ...open, status: 'resolved', picked: getReachableFloor(state, open.actorId).find((f) => f.item.id === open.itemId)?.item ?? null }
    case 'release': return { ...open, status: 'resolved', facts: getReleaseFacts(state, open) }
    case 'holdBack': return { ...open, status: 'resolved', facts: getHoldBackFacts(state, open) }
    case 'drag': return { ...open, status: 'resolved', facts: getDragFacts(state, open) }
    case 'explosion': return { ...open, status: 'resolved', facts: getExplosionFacts(state, open) }
    case 'cast': return { ...open, status: 'resolved', facts: getCastFacts(state, open) }
    case 'move': return { ...open, status: 'resolved', facts: getMoveFacts(state, open) }
    default: return { ...open, status: 'resolved' }
  }
}

// What the attack's delivery does to its target's own action.
function getInterruption(state: CombatState, root: AttackAction, facts: Delivery | null): Interruption {
  const target = root.targetId ? state.characters[root.targetId] : undefined
  return (facts && target ? outcomeOf(facts, target)?.interruption : undefined) ?? 'none'
}

// combat.tex "Escape": "Being stunned allows for a reaction to escape
// without the possibility of active resistance." A holder the attack
// stunned gives whoever they hold an escape, opened as a maneuver of
// theirs that nobody may resist, for them to take or skip.
function escapesOnStun(state: CombatState, root: Action, newId: () => string): Action[] {
  if ((root.kind !== 'strike' && root.kind !== 'shoot') || root.interruption !== 'stunned' || !root.targetId) return []
  const holderId = root.targetId
  return state.grapples
    .filter((g) => g.members.includes(holderId) && holds(g, holderId))
    .map((g) => getPartner(g, holderId))
    // a grab's own blow is not one the grabber escapes the hold back from
    .filter((heldId) => !(root.kind === 'strike' && root.grabbed && heldId === root.actorId))
    .filter((heldId) => state.characters[heldId] !== undefined)
    .map((heldId) => ActionSchema.parse({ kind: 'grapple', maneuver: 'escape', unresisted: true, id: newId(), actorId: heldId, targetId: holderId, spawnedBy: root.id }))
}

// An opportunity attack fought against a mover or a triggering action, once
// it has landed, hands the root back: on to its next threatener, or to its end.
function afterLanding(state: CombatState, resolved: Action, newId: () => string): CombatState {
  const reaction = resolved.spawnedBy ? getAction(state, resolved.spawnedBy) : null
  const root = reaction ? getRootOf(state, reaction) : null
  if (reaction?.kind !== 'opportunityAttack' || root?.status !== 'rolled') return state
  if (root.kind === 'move') return advanceMove(state, root, newId)
  return isTriggeringAction(root) ? advanceTriggering(state, root, newId) : state
}

// combat.tex "Flanking", "Follow", "Evasion": the actions the resolved one's
// reactions open, in the order they were declared. A flanker's opportunity
// attack "can be voided if the target gets out of range", so one whose
// target ended beyond the reactor's reach opens nothing. An opportunity
// attack against a move or a triggering action was opened before the root
// resolved (see `advanceMove`, `advanceTriggering`) and is not opened again
// here; a cancelled action opens nothing. A cast that
// hit with an area to it opens that area as an
// explosion of the caster's, aimed and played out on its own (combat.tex
// "Explosions"; the caster's part is done).
function spawn(state: CombatState, root: Action, newId: () => string): Action[] {
  if (isTriggeringAction(root) && root.cancelled) return []
  const opened = getReactionsTo(state, root.id).flatMap((reaction): Action[] => {
    switch (reaction.kind) {
      // combat.tex "Flanking": opened here, after the strike it answers has
      // landed. Any other root's own opportunity attacks are opened
      // earlier (`advanceMove`, `advanceTriggering`) and are already spawned by
      // the time their root gets here.
      case 'opportunityAttack': {
        if (root.kind !== 'strike') return []
        const reactor = state.characters[reaction.actorId]
        const distance = getDistanceBetween(state, reaction.actorId, root.actorId)
        if (!reactor || (distance !== null && distance > getMeleeRange(reactor))) return []
        return [getOpportunityAction(state, reaction, newId())]
      }
      case 'follow':
        return [openMove(reaction, newId, { budget: root.cost?.AP ?? null })]
      // combat.tex "Evasion": on a hit, "take the attack normally and then
      // use up to 2 AP to move if not interrupted"; on a graze, "jump to try
      // to gain cover"; on a miss, "spend their movement surge immediately
      // to escape or do the same as in the graze". The move is bought with
      // the AP the reflex already paid; a miss leaves how far to the surge,
      // and so to the evader.
      case 'evasion': {
        if (root.kind !== 'shoot' || root.interruption !== 'none' || reaction.stay) return []
        const AP = reaction.cost?.AP ?? 0
        return [openMove(reaction, newId, { budget: root.roll?.degree === 'miss' ? null : AP, prepaid: AP })]
      }
      // combat.tex "Avoiding an Explosion": "On a miss, they can move 2 AP
      // after the explosion" — bought with the AP the reflex paid, and not
      // at all by one the blast interrupted (combat.tex "Interruption":
      // "Movement is cancelled"). A graze moved before it.
      case 'avoidExplosion': {
        if (root.kind !== 'explosion' || reaction.roll?.degree !== 'miss') return []
        const facts = root.facts?.[reaction.actorId] ?? []
        const reactor = state.characters[reaction.actorId]
        if (reactor && facts.some((d) => (outcomeOf(d, reactor)?.interruption ?? 'none') !== 'none')) return []
        return [openMove(reaction, newId, { budget: 2, prepaid: reaction.cost?.AP ?? 0 })]
      }
      default:
        return []
    }
  })
  opened.push(...escapesOnStun(state, root, newId))
  if (root.kind === 'cast' && root.roll?.degree === 'hit' && !isCancelled(state, root) && isSpellKey(root.key) && SPELLS[root.key].type !== 'charged' && SPELLS[root.key].effects.some((e) => e.target === 'area' && e.area !== null)) {
    opened.push(ActionSchema.parse({ kind: 'explosion', id: newId(), actorId: root.actorId, source: 'cast', key: root.key, spawnedBy: root.id }))
  }
  return opened
}
