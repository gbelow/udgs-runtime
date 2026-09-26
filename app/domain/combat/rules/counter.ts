import type { Action, ActionOf, CombatState, StrikeAction } from '../types'
import { makeAction } from '../factories'
import { getAction, getReactionsTo } from './log'

// abilities.tex "Counterattack": "You can attack in response to an attack,
// as long as you are within range. Both attacks are made against the
// opponent's SD. The attack with the higher result hits first, having the
// chance to interrupt the opponent. The counterattack receives -2 to hit."
// Its die is thrown with the attack's, so both results are known once the
// attack is rolled; on a tie both land and neither interrupts the other
// (the table's ruling).

// The strike a counterattack opens, as declared on the reaction, aimed back
// at the attacker it answers: rolled with that attack, and paid for by the
// reaction.
export function getCounterStrike(reaction: ActionOf<'counterattack'>, id: string): StrikeAction {
  const { weaponKey, attack, variant, location } = reaction
  return makeAction('strike', { id, actorId: reaction.actorId, targetId: reaction.targetId, weaponKey, attack, variant, location, spawnedBy: reaction.id, step: 'post', roll: reaction.roll })
}

// The counterattack the attack was answered with, if it was.
export function getCounterattack(state: CombatState, root: Action): ActionOf<'counterattack'> | null {
  return getReactionsTo(state, root.id).find((r): r is ActionOf<'counterattack'> => r.kind === 'counterattack') ?? null
}

// Where the counterattack's strike lands against the attack: ahead of it on
// a higher result, alongside it on the same, after it on a lower one; null
// until both are rolled.
export type CounterSlot = 'before' | 'tie' | 'after'

export function getCounterSlot(root: Action, reaction: ActionOf<'counterattack'>): CounterSlot | null {
  if (!root.roll || !reaction.roll) return null
  if (reaction.roll.score > root.roll.score) return 'before'
  return reaction.roll.score === root.roll.score ? 'tie' : 'after'
}

// The strike the counterattack has opened, once it has.
export function getCounterStrikeOf(state: CombatState, reaction: ActionOf<'counterattack'>): StrikeAction | null {
  return state.actions.find((a): a is StrikeAction => a.kind === 'strike' && a.spawnedBy === reaction.id) ?? null
}

// The counterattack that opened the strike; null for a strike opened any
// other way.
export function getOpeningCounter(state: CombatState, strike: StrikeAction): ActionOf<'counterattack'> | null {
  const opener = strike.spawnedBy ? getAction(state, strike.spawnedBy) : null
  return opener?.kind === 'counterattack' ? opener : null
}
