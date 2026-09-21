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
  // whether a die commits the action; one without is committed by paying.
  // A move is the exception the lens `needsDie` makes: difficult terrain
  // puts a Balance test on it. On a reaction, whether it is a test of its
  // own, thrown with the root's die.
  die: boolean
}

export const ACTIONS = {
  // combat.tex "Strike"
  strike:      { label: 'strike',       type: 'action',   price: null,          reactsTo: [],         die: true },
  // combat.tex "Accuracy", "Shoot"
  shoot:       { label: 'shoot',        type: 'action',   price: null,          reactsTo: [],         die: true },
  // combat.tex "Explosions": no test of the attacker's — "the DL of the
  // explosion is equal to the shooting skill", and it is the reactors who roll
  explosion:   { label: 'explosion',    type: 'action',   price: null,          reactsTo: [],         die: false },
  // combat.tex "Movement"
  move:        { label: 'move',         type: 'action',   price: null,          reactsTo: [],         die: false },
  // combat.tex "Defend": "There are four types of defense: Evade, Evasive
  // Jump, Intercept, and Block."
  evade:       { label: 'evade',        type: 'reaction', price: 'evade',       reactsTo: ['strike'], die: false },
  evasiveJump: { label: 'evasive jump', type: 'reaction', price: 'evasiveJump', reactsTo: ['strike'], die: false },
  block:       { label: 'block',        type: 'reaction', price: 'block',       reactsTo: ['strike'], die: false },
  intercept:   { label: 'intercept',    type: 'reaction', price: 'intercept',   reactsTo: ['strike'], die: false },
  // combat.tex "Reflex": "Evasion" and "Guard", the two reactions to a shot
  evasion:     { label: 'evasion',      type: 'reaction', price: 'reflex',      reactsTo: ['shoot'],  die: false },
  guard:       { label: 'guard',        type: 'reaction', price: 'guard',       reactsTo: ['shoot'],  die: false },
  // combat.tex "Avoiding an Explosion": "Spend 3 AP and make a reflex skill
  // test against the DL of the explosion"
  avoidExplosion: { label: 'avoid explosion', type: 'reaction', price: 'avoidExplosion', reactsTo: ['explosion'], die: true },
  // combat.tex "Opportunity Attack", "Flanking", "Follow": priced by the
  // action each opens when the root resolves
  opportunityAttack: { label: 'opportunity attack', type: 'reaction', price: null, reactsTo: ['strike', 'move'], die: false },
  follow:      { label: 'follow',       type: 'reaction', price: null,          reactsTo: ['move'],   die: false },
} as const satisfies Record<ActionKind, ActionDef>

export function isReaction(kind: ActionKind): boolean {
  return ACTIONS[kind].type === 'reaction'
}

export function reactsTo(kind: ActionKind, root: ActionKind): boolean {
  return (ACTIONS[kind].reactsTo as readonly ActionKind[]).includes(root)
}
