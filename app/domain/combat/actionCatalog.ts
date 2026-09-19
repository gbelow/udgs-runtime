import type { ActionKind as PricedAction } from '../tables'
import type { ActionKind } from './types'

// What kind of thing each action is. `type` is combat.tex "Reactions": a
// reaction is taken on someone else's turn and only in answer to one of the
// kinds it `reactsTo`. `price` names the row of ACTION_COSTS that is its
// whole cost; null where the price is the declaration's to say (a strike
// costs what its weapon row and variation cost).
export type ActionDef = {
  label: string
  type: 'action' | 'reaction'
  price: PricedAction | null
  reactsTo: readonly ActionKind[]
}

export const ACTIONS = {
  // combat.tex "Strike"
  strike:      { label: 'strike',       type: 'action',   price: null,          reactsTo: [] },
  // combat.tex "Defend": "There are four types of defense: Evade, Evasive
  // Jump, Intercept, and Block."
  evade:       { label: 'evade',        type: 'reaction', price: 'evade',       reactsTo: ['strike'] },
  evasiveJump: { label: 'evasive jump', type: 'reaction', price: 'evasiveJump', reactsTo: ['strike'] },
  block:       { label: 'block',        type: 'reaction', price: 'block',       reactsTo: ['strike'] },
  intercept:   { label: 'intercept',    type: 'reaction', price: 'intercept',   reactsTo: ['strike'] },
} as const satisfies Record<ActionKind, ActionDef>

export function isReaction(kind: ActionKind): boolean {
  return ACTIONS[kind].type === 'reaction'
}

export function reactsTo(kind: ActionKind, root: ActionKind): boolean {
  return (ACTIONS[kind].reactsTo as readonly ActionKind[]).includes(root)
}
