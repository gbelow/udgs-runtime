import type { CampaignCharacter } from '../../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import type { CombatState, MoveAction, RootAction } from '../types'
import { SURGES } from '../../tables'
import { canSurge } from '../../character/rules/surge'
import { isDead, isImmobile } from '../../character/rules/afflictions'
import { getReactionsTo } from './log'
import { isInGrapple } from './partners'
import { isInTurn } from './turn'
import { isConcentrating } from '../../character/rules/concentration'

// combat.tex "Flee": "It is possible to activate the movement surge as a
// reaction to prevent them from entering a 4m perimeter from the character,
// or after receiving a melee attack. This reaction interrupts the opponents
// turn, which is resumed after the flee. The flee action can only use
// actions allowed by movement surge."

export const FLEE_PERIMETER = 4

// The flee's price is the movement surge itself, made as it is paid; null
// when the surge cannot be made.
export function getFleeCost(c: CampaignCharacter): ActionCost | null {
  return canSurge('movement')(c) ? { AP: 0, STA: SURGES.movement.STA } : null
}

// Why the character cannot flee, or null. The flee interrupts someone
// else's turn, so never the one in turn; and one in a grapple gets out of it
// by a maneuver (combat.tex "Escape"), not by fleeing (the table's ruling).
export function getFleeBar(state: CombatState, c: CampaignCharacter): string | null {
  if (isInTurn(state, c.id)) return 'your turn'
  if (isImmobile(c)) return 'immobile'
  if (isConcentrating(c)) return 'concentrating'
  if (isInGrapple(state, c.id)) return 'grappled'
  if (c.usedSurge !== null) return 'surge used this round'
  return canSurge('movement')(c) ? null : 'cannot afford the surge'
}

// The step of the move's path the first flee from it fired on: the mover
// stops one space short of it, as where the flee was triggered. Null when
// nobody flees it.
export function getFleeStep(state: CombatState, move: MoveAction): number | null {
  const steps = getReactionsTo(state, move.id).flatMap((r) => (r.kind === 'flee' && r.at !== null ? [r.at] : []))
  return steps.length > 0 ? Math.min(...steps) : null
}

// Who the landed action offers a flee as a follow-up, in the order the
// answers were declared, when they can flee: a strike's target ("after
// receiving a melee attack"), and — combat.tex "Evasion": "On a miss, the
// character does not take the attack and can spend their movement surge
// immediately to escape" — each evader a missed shot leaves free to move.
export function getFleeFollowUps(state: CombatState, root: RootAction): string[] {
  const offered = root.kind === 'strike' && root.targetId ? [root.targetId]
    : root.kind === 'shoot' && root.roll?.degree === 'miss'
      ? getReactionsTo(state, root.id).flatMap((r) => (r.kind === 'evasion' && !r.stay ? [r.actorId] : []))
      : []
  return offered.filter((id) => {
    const c = state.characters[id]
    return !!c && getFleeBar(state, c) === null
  })
}

// Who the landed action sends fleeing, in the order they declared it: each
// flee made against a move, and whoever took a flee follow-up.
export function getFleersOf(state: CombatState, root: RootAction): string[] {
  if (root.kind === 'fleeFollowUp') return [root.actorId]
  return getReactionsTo(state, root.id).flatMap((r) => (r.kind === 'flee' ? [r.actorId] : []))
}

// Whether the character can take a turn waiting in the queue: still in the
// fight and alive.
export function canTakeQueuedTurn(state: CombatState, id: string): boolean {
  const c = state.characters[id]
  return !!c && !isDead(c)
}
