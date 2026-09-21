import type { CampaignCharacter } from '../../types'
import { ActionSchema, type Action, type ActionDraft, type CombatState, type HOPPurchase } from '../types'
import { isReaction } from '../actionCatalog'
import {
  findOption,
  getAttackTerms,
  getDeclaredCost,
  getDL,
  getOpenAction,
  getReactionsTo,
  getTargetIds,
  isDeclarationComplete,
  isPiercingStrike,
  scoreAttack,
} from '../lenses/action'
import { getHOPOptions, getStrikeFacts } from '../lenses/damage'
import { reduceCharacter, type Phase } from '../reduce'
import { sumTerms } from '../../character/lenses/terms'
import { ActionCost } from '../../character/lenses/actionCosts'

// The three phases of an action, as commands. Everything up to the roll only
// edits the action record and is free to undo; `rollAction` throws the die
// and takes the price in one update, and from there the only way forward is
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
  return actions.reduce((s, action) => mapCharacters(s, reduceCharacter(action, phase)), state)
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

// Aims the open action. Changing the target drops any reaction the previous
// one had declared — it was answering an attack no longer aimed at it.
export function setTarget(targetId: string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared') return state
    if (!getTargetIds(state, open).includes(targetId)) return state
    return {
      ...state,
      actions: state.actions
        .filter((a) => a.reactionTo !== open.id)
        .map((a) => (a.id === open.id ? { ...a, targetId } : a)),
    }
  }
}

// The target's answer to the open action (combat.tex "Reactions"), declared
// before the die. A defender has one answer at a time: a new one replaces it.
export function declareReaction(actorId: string, draft: ActionDraft, newId: () => string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared' || open.targetId !== actorId) return state
    if (!findOption(state, actorId, draft)?.available) return state
    const reaction = ActionSchema.parse({ ...draft, id: newId(), actorId, targetId: open.actorId, reactionTo: open.id })
    return {
      ...state,
      actions: [...state.actions.filter((a) => !(a.reactionTo === open.id && a.actorId === actorId)), reaction],
    }
  }
}

// Takes back a declared reaction: the defender takes the attack on SD.
export function withdrawReaction(actorId: string): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared') return state
    return { ...state, actions: state.actions.filter((a) => !(a.reactionTo === open.id && a.actorId === actorId)) }
  }
}

// Abandons the open action and everything declared in answer to it. Only
// while declared: once the die is thrown the price is paid and the action
// has to be played out.
export function cancelAction(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared') return state
    return { ...state, actions: state.actions.filter((a) => a.id !== open.id && a.reactionTo !== open.id) }
  }
}

// The commit. Prices the action and its reactions off their actors as they
// stand, scores the die against the DL the declarations add up to, and takes
// every price — all in one update, so no state exists in which the die is
// known and the cost is not paid. Refused, and nothing happens, when a
// declaration is incomplete or someone cannot pay what they declared.
export function rollAction(die: number): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'declared' || open.targetId === null) return state
    const actor = state.characters[open.actorId]
    if (!actor || !isDeclarationComplete(actor, open)) return state
    if (!getTargetIds(state, open).includes(open.targetId)) return state

    const priced: Action[] = []
    for (const a of [open, ...getReactionsTo(state, open.id)]) {
      const cost = priceFor(state, a)
      if (!cost) return state
      priced.push({ ...a, cost })
    }

    const DL = getDL(state, open)
    const score = die + (open.kind === 'strike' ? sumTerms(getAttackTerms(actor, open)) : 0)
    const { degree, HOP } = scoreAttack(score, DL, open.kind === 'strike' && isPiercingStrike(actor, open))

    const rolled = priced.map((a): Action =>
      a.id === open.id
        ? { ...a, status: 'rolled', roll: { die, DL, score, degree, HOP } }
        : { ...a, status: 'resolved' },
    )
    return applyPhase(replaceActions(state, rolled), rolled, 'roll')
  }
}

// What the action costs its actor now, or null if they cannot pay it.
function priceFor(state: CombatState, action: Action): ActionCost | null {
  const c = state.characters[action.actorId]
  if (!c) return null
  const cost = getDeclaredCost(c, action)
  if (!cost || c.resources.AP < cost.AP || c.resources.STA < cost.STA) return null
  return cost
}

// combat.tex "Success Overflow": buys one effect out of the hit's HOP. Only
// what the option list offers as open, so the command refuses exactly what
// the button shows as closed.
export function spendHOP(purchase: HOPPurchase): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.kind !== 'strike' || open.status !== 'rolled') return state
    if (!getHOPOptions(state, open).find((o) => o.purchase === purchase)?.available) return state
    return replaceActions(state, [{ ...open, spent: { ...open.spent, [purchase]: (open.spent[purchase] ?? 0) + 1 } }])
  }
}

// Takes one purchase back. Nothing has landed on the target until the
// action resolves, so the overflow is free to re-spend up to that point.
export function refundHOP(purchase: HOPPurchase): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.kind !== 'strike' || open.status !== 'rolled') return state
    const bought = open.spent[purchase] ?? 0
    if (bought === 0) return state
    const { [purchase]: _, ...rest } = open.spent
    return replaceActions(state, [{ ...open, spent: bought > 1 ? { ...rest, [purchase]: bought - 1 } : rest }])
  }
}

// Lands the rolled action on everyone it concerns and closes it. A strike
// has its attacker's side written down first, so the record says what
// landed and the target's reducer needs nothing but the action.
export function resolveAction(): Updater {
  return (state) => {
    const open = getOpenAction(state)
    if (!open || open.status !== 'rolled') return state
    const resolved: Action = open.kind === 'strike'
      ? { ...open, status: 'resolved', facts: getStrikeFacts(state, open) }
      : { ...open, status: 'resolved' }
    return applyPhase(replaceActions(state, [resolved]), [resolved], 'resolve')
  }
}
