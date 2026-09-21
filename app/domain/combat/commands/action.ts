import type { CampaignCharacter } from '../../types'
import { ActionSchema, type Action, type ActionDraft, type CombatState, type Degree, type HOPPurchase, type MoveAction } from '../types'
import { isReaction } from '../actionCatalog'
import {
  areReactionsComplete,
  findOption,
  getAction,
  getAttackTerms,
  getOpportunityStrike,
  getDeclaredCost,
  getDL,
  getOpenAction,
  getReactionsTo,
  getTargetIds,
  isDeclarationComplete,
  isPiercingAttack,
  needsDie,
  scoreAttack,
} from '../lenses/action'
import { getAttackFacts, getHOPOptions, getOutcome } from '../lenses/damage'
import { getBalanceDL, getBalanceTestTerms, getMoveFacts, getMoveOverride, getMovePrice, getMoveWaypoint, getOpportunityAttacks } from '../lenses/move'
import { getDistanceBetween, getMeleeRange } from '../lenses/board'
import { reduceBoard, reduceCharacter, type Phase } from '../reduce'
import { sumTerms } from '../../character/lenses/terms'
import { ActionCost } from '../../character/lenses/actionCosts'

// The phases of an action, as commands. Everything up to the roll only edits
// the action record and is free to undo: the declaration is edited, then
// `commitAction` locks it so its triggers can be loaded and answered;
// `rollAction` (or `payAction`, for an action with no die) throws the die and
// takes the price in one update, and from there the only way forward is
// `resolveAction`. Every command returns the state unchanged when asked for
// something the phase does not allow, so the store can dispatch blindly.

type Updater = (state: CombatState) => CombatState

function replaceActions(state: CombatState, next: Action[]): CombatState {
  return { ...state, actions: state.actions.map((a) => next.find((n) => n.id === a.id) ?? a) }
}

function mapCharacters(state: CombatState, f: (c: CampaignCharacter) => CampaignCharacter): CombatState {
  return { ...state, characters: Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, f(c)])) }
}

function applyPhase(state: CombatState, actions: Action[], phase: Phase): CombatState {
  return actions.reduce((s, action) => {
    const next = mapCharacters(s, reduceCharacter(action, phase))
    return next.board ? { ...next, board: reduceBoard(next, action, phase)(next.board) } : next
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
    if ((open.kind === 'strike' || open.kind === 'shoot') && (open.targetId === null || !getTargetIds(state, open).includes(open.targetId))) return state
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
    const root = reaction?.reactionTo ? getAction(withdrawn, reaction.reactionTo) : null
    return root?.kind === 'move' && root.status === 'rolled' ? advanceMove(withdrawn, root, newId) : withdrawn
  }
}

// A reaction to the committed action (combat.tex "Reactions"), declared
// before the die by anyone the action triggers something in. A character has
// one answer at a time: a new one replaces it.
export function declareReaction(actorId: string, draft: ActionDraft, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed' || open.actorId === actorId) return state
    if (!findOption(state, actorId, draft)?.available) return state
    const reaction = ActionSchema.parse({ ...draft, id: newId(), actorId, targetId: open.actorId, reactionTo: open.id })
    return {
      ...state,
      actions: [...state.actions.filter((a) => !(a.reactionTo === open.id && a.actorId === actorId)), reaction],
    }
  }
}

// Fills in what the reactor's declared reaction still has to say — the
// strike an opportunity attack opens — while the root is still waiting for
// its die. The kind is not a declaration and cannot change.
export function amendReaction(actorId: string, fields: Partial<ActionDraft>): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed') return state
    const reaction = getReactionsTo(state, open.id).find((r) => r.actorId === actorId)
    if (!reaction || (fields.kind !== undefined && fields.kind !== reaction.kind)) return state
    return replaceActions(state, [ActionSchema.parse({ ...reaction, ...fields, kind: reaction.kind })])
  }
}

// Takes back a declared reaction: the defender takes the attack on SD, the
// reactor who had chosen an opportunity attack is back to choosing.
export function withdrawReaction(actorId: string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed') return state
    return { ...state, actions: state.actions.filter((a) => !(a.reactionTo === open.id && a.actorId === actorId)) }
  }
}

// One step back: the reaction declared last is taken back, whoever's it was.
export function withdrawLastReaction(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed') return state
    const last = getReactionsTo(state, open.id).at(-1)
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

// The die. Prices the committed action and its reactions off their actors
// as they stand, scores the die against the DL the declarations add up to,
// and takes every price — all in one update, so no state exists in which the
// die is known and the cost is not paid. Refused, and nothing happens, when
// a reaction has not said all it must or someone cannot pay what they
// declared. A strike or a shot is scored against the target's defense; a
// move across difficult terrain is a Balance test against the ground
// (combat.tex "Balance"), and pays for the path as the test leaves it.
export function rollAction(die: number, newId: () => string = () => `${Date.now()}`): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed' || !needsDie(state, open)) return state
    const actor = state.characters[open.actorId]
    if (!actor || !areReactionsComplete(state, open)) return state

    const test = open.kind === 'strike' || open.kind === 'shoot'
      ? (() => {
          const DL = getDL(state, open)
          const score = die + sumTerms(getAttackTerms(actor, open))
          return { DL, score, ...scoreAttack(score, DL, isPiercingAttack(actor, open)) }
        })()
      : open.kind === 'move'
        ? (() => {
            const DL = getBalanceDL(state, open)
            const score = die + sumTerms(getBalanceTestTerms(actor))
            return { DL, score, degree: scoreTest(score, DL), HOP: 0 }
          })()
        : null
    if (!test) return state
    const withRoll: Action = { ...open, roll: { die, ...test } }

    const priced: Action[] = []
    for (const a of [withRoll, ...getReactionsTo(state, open.id)]) {
      const cost = priceFor(state, a)
      if (!cost) return state
      priced.push({ ...a, cost })
    }

    const rolled = priced.map((a): Action => (a.id === open.id ? { ...a, status: 'rolled' } : { ...a, status: 'resolved' }))
    return afterPaying(applyPhase(replaceActions(state, rolled), rolled, 'roll'), open.id, newId)
  }
}

// play.tex "Degrees of success": over the DL by 10 is a critical, by 5 a
// hit, by 0 a graze, less a miss.
function scoreTest(score: number, DL: number): Degree {
  const over = score - DL
  return over >= 10 ? 'critical' : over >= 5 ? 'hit' : over >= 0 ? 'graze' : 'miss'
}

// The die's counterpart for a committed action with none (combat.tex
// "Movement": a move is bought, not rolled). Prices it and its reactions off
// their actors as they stand and takes every price, in one update; refused
// when a reaction has not said all it must or someone cannot pay.
export function payAction(newId: () => string = () => `${Date.now()}`): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'committed' || needsDie(state, open)) return state
    if (!areReactionsComplete(state, open)) return state
    const priced: Action[] = []
    for (const a of [open, ...getReactionsTo(state, open.id)]) {
      const cost = priceFor(state, a)
      if (!cost) return state
      priced.push({ ...a, cost })
    }
    const committed = priced.map((a): Action => (a.id === open.id ? { ...a, status: 'rolled' } : { ...a, status: 'resolved' }))
    return afterPaying(applyPhase(replaceActions(state, committed), committed, 'roll'), open.id, newId)
  }
}

// What follows the payment: a move with opportunity attacks declared against
// it has the first of them opened before it resolves.
function afterPaying(state: CombatState, id: string, newId: () => string): CombatState {
  const paid = getAction(state, id)
  return paid?.kind === 'move' ? advanceMove(state, paid, newId) : state
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
  const next = getOpportunityAttacks(state, move).find(({ strike }) => strike === null)
  if (!next || next.reaction.at! > walked) return state
  const strike = getOpportunityStrike(next.reaction, newId())
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
  if (!cost || c.resources.AP < cost.AP || c.resources.STA < cost.STA) return null
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
    return replaceActions(state, [{ ...open, spent: { ...open.spent, [purchase]: (open.spent[purchase] ?? 0) + 1 } }])
  }
}

// Takes one purchase back. Nothing has landed on the target until the
// action resolves, so the overflow is free to re-spend up to that point.
export function refundHOP(purchase: HOPPurchase): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || (open.kind !== 'strike' && open.kind !== 'shoot') || open.status !== 'rolled') return state
    const bought = open.spent[purchase] ?? 0
    if (bought === 0) return state
    const { [purchase]: _, ...rest } = open.spent
    return replaceActions(state, [{ ...open, spent: bought > 1 ? { ...rest, [purchase]: bought - 1 } : rest }])
  }
}

// Lands the rolled action on everyone it concerns and closes it. A strike
// or a shot has its attacker's side written down first, so the record says
// what landed and the target's reducer needs nothing but the action; what
// it did to the target's own action is written beside it, for the move it
// may have cut short or the one an evasion may open.
export function resolveAction(newId: () => string = () => `${Date.now()}`): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'rolled') return state
    const resolved: Action = open.kind === 'strike' || open.kind === 'shoot'
      ? (() => {
          const facts = getAttackFacts(state, open)
          const target = open.targetId ? state.characters[open.targetId] : undefined
          return { ...open, status: 'resolved' as const, facts, interruption: facts && target ? getOutcome(facts, target).interruption : 'none' as const }
        })()
      : open.kind === 'move'
        ? { ...open, status: 'resolved', facts: getMoveFacts(state, open) }
        : { ...open, status: 'resolved' }
    const landed = applyPhase(replaceActions(state, [resolved]), [resolved], 'resolve')
    const spawned = { ...landed, actions: [...landed.actions, ...spawn(landed, resolved, newId)] }
    return afterLanding(spawned, resolved, newId)
  }
}

// An opportunity attack fought against a mover, once it has landed, hands
// the move back: on to the next one, or to its end.
function afterLanding(state: CombatState, resolved: Action, newId: () => string): CombatState {
  const reaction = resolved.spawnedBy ? getAction(state, resolved.spawnedBy) : null
  const root = reaction?.reactionTo ? getAction(state, reaction.reactionTo) : null
  return reaction?.kind === 'opportunityAttack' && root?.kind === 'move' && root.status === 'rolled' ? advanceMove(state, root, newId) : state
}

// combat.tex "Flanking", "Follow", "Evasion": the actions the resolved one's
// reactions open, in the order they were declared. A flanker's opportunity
// attack "can be voided if the target gets out of range", so one whose
// target ended beyond the reactor's reach opens nothing. An opportunity
// attack against a move was opened before the move resolved and is not
// opened again.
function spawn(state: CombatState, root: Action, newId: () => string): Action[] {
  return getReactionsTo(state, root.id).flatMap((reaction): Action[] => {
    switch (reaction.kind) {
      case 'opportunityAttack': {
        if (root.kind !== 'strike') return []
        const reactor = state.characters[reaction.actorId]
        const distance = getDistanceBetween(state, reaction.actorId, root.actorId)
        if (!reactor || (distance !== null && distance > getMeleeRange(reactor))) return []
        return [getOpportunityStrike(reaction, newId())]
      }
      case 'follow':
        return [ActionSchema.parse({ kind: 'move', id: newId(), actorId: reaction.actorId, budget: root.cost?.AP ?? null, spawnedBy: reaction.id })]
      // combat.tex "Evasion": on a hit, "take the attack normally and then
      // use up to 2 AP to move if not interrupted"; on a graze, "jump to try
      // to gain cover"; on a miss, "spend their movement surge immediately
      // to escape or do the same as in the graze". The move is bought with
      // the AP the reflex already paid; a miss leaves how far to the surge,
      // and so to the evader.
      case 'evasion': {
        if (root.kind !== 'shoot' || root.interruption !== 'none' || reaction.stay) return []
        const AP = reaction.cost?.AP ?? 0
        return [ActionSchema.parse({ kind: 'move', id: newId(), actorId: reaction.actorId, budget: root.roll?.degree === 'miss' ? null : AP, prepaid: AP, spawnedBy: reaction.id })]
      }
      default:
        return []
    }
  })
}
