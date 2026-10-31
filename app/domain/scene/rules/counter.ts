import type { Action, ActionOf, SceneState, ShootAction, StrikeAction } from '../types'
import { makeAction } from '../factories'
import { getAction, getOpenedBy } from './log'
import { pickAim, pickShotDeclaration, pickStrikeDeclaration } from './declaration'

// abilities.tex "Counterattack": "You can attack in response to an attack,
// as long as you are within range. Both attacks are made against the
// opponent's SD. The attack with the higher result hits first, having the
// chance to interrupt the opponent. The counterattack receives -2 to hit."
// abilities.tex "Archer's Reflexes": the same for a shot answered by a quick
// shot, each made against its own target's SD, not necessarily each other's.
// Its die is thrown with the attack's, so both results are known once the
// attack is rolled; on a tie both land and neither interrupts the other
// (the table's ruling).

// The strike a counterattack opens, as declared on the reaction, aimed back
// at the attacker it answers: rolled with that attack, paid for by the
// reaction, and made under the reaction's recipe (rules/recipes.ts).
export function getCounterStrike(reaction: ActionOf<'counterattack'>, id: string): StrikeAction {
  return makeAction('strike', { id, actorId: reaction.actorId, targetId: reaction.targetId, ...pickStrikeDeclaration(reaction), ...pickAim(reaction), spawnedBy: reaction.id, recipe: reaction.recipe, step: 'post', roll: reaction.roll })
}

// The shot a counterattack made as a shot opens: the same, loaded from
// `ammoId`, aimed at whom the reactor chose.
export function getCounterShot(reaction: ActionOf<'counterattack'>, id: string): ShootAction {
  return makeAction('shoot', { id, actorId: reaction.actorId, targetId: reaction.targetId, ...pickShotDeclaration(reaction), ...pickAim(reaction), spawnedBy: reaction.id, recipe: reaction.recipe, step: 'post', roll: reaction.roll })
}

// What the counterattack opens, a strike or a shot as it was declared.
export function getCounterAttack(reaction: ActionOf<'counterattack'>, id: string): StrikeAction | ShootAction {
  return reaction.mode === 'shoot' ? getCounterShot(reaction, id) : getCounterStrike(reaction, id)
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

// The strike or shot the counterattack has opened, once it has.
export function getCounterAttackOf(state: SceneState, reaction: ActionOf<'counterattack'>): StrikeAction | ShootAction | null {
  const opened = getOpenedBy(state, reaction)
  return opened?.kind === 'strike' || opened?.kind === 'shoot' ? opened : null
}

// The counterattack that opened the strike or shot; null for one opened any
// other way.
export function getOpeningCounter(state: SceneState, attack: StrikeAction | ShootAction): ActionOf<'counterattack'> | null {
  const opener = attack.spawnedBy ? getAction(state, attack.spawnedBy) : null
  return opener?.kind === 'counterattack' ? opener : null
}
