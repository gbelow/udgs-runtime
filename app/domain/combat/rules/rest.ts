import type { CampaignCharacter } from '../../types'
import type { CombatState, RootAction } from '../types'
import { getActionCost } from '../../character/rules/actionCosts'
import type { ReactionMove } from './reactionMoves'

// combat.tex "Rest": "The character is allowed to move 4 AP worth of careful
// movement while resting during their own turn" — a rest, or a cast rested
// through (spells.tex "Effortless Spell"). The move is the actor's to make
// or not, once, while the rest waits to land: it is played out before the
// rest's effects, a spell's among them.
export function canMoveWhileResting(state: CombatState, root: RootAction): boolean {
  const resting = root.kind === 'rest' || (root.kind === 'cast' && (root.improved.effortless ?? 0) > 0)
  return resting && root.step === 'post' && state.board?.placements[root.actorId] !== undefined
    && !hasRestMove(state, root.id)
}

export function hasRestMove(state: CombatState, rootId: string): boolean {
  return state.actions.some((a) => a.kind === 'move' && a.spawnedBy === rootId)
}

// The move a rest allows: careful only, as far as the rest's AP reaches,
// which has already paid for it.
export function getRestMove(c: CampaignCharacter): ReactionMove {
  const AP = getActionCost(c, 'rest').AP
  return { movement: 'careful', movements: ['careful'], budget: AP, prepaid: AP }
}
