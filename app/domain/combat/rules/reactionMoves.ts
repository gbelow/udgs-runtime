import type { Action, ActionOf, BlastAction, CombatState, MoveAction } from '../types'
import { MOVEMENT_KINDS } from '../../lists'
import { outcomeOf } from './damage'

// The moves a reaction opens for its reactor, as the fields of the move it
// opens: `budget` the most AP it may cost, `prepaid` what the reaction
// already paid towards it, and whatever kinds of movement it grants.
export type ReactionMove = Partial<Pick<MoveAction, 'movement' | 'movements' | 'budget' | 'prepaid' | 'surcharge' | 'surchargedMovements'>>

// combat.tex "Avoiding an Explosion": "On a critical, the character can run
// by spending one extra STA. On a hit, they can spend an extra STA to jump
// in any direction before the explosion occurs. On a graze, they can move 1
// AP before the explosion." Each degree unlocks what a lesser one would have
// too, so a critical can still take a graze's plain move instead of paying
// to run. The reaction's AP buys the move, as an evasion's does, and the
// run's extra STA is on top, the jump's the jump's own (combat.tex "Movement
// Costs and Speeds" prices a jump in STA already). A miss moves after the
// blast instead (`getEscapeAfterBlast`).
export function getEscapeBeforeBlast(reaction: ActionOf<'avoidExplosion'>): ReactionMove | null {
  if (!reaction.roll) return null
  const AP = reaction.cost?.AP ?? 0
  switch (reaction.roll.degree) {
    case 'critical': return { budget: AP, prepaid: AP, movement: 'run', movements: [...MOVEMENT_KINDS], surchargedMovements: ['run'], surcharge: { AP: 0, STA: 1 } }
    case 'hit': return { budget: AP, prepaid: AP, movement: 'jump', movements: MOVEMENT_KINDS.filter((k) => k !== 'run') }
    case 'graze': return { budget: 1, prepaid: AP }
    default: return null
  }
}

// combat.tex "Follow": a move of the follower's own, capped at what the
// triggering move cost.
export function getFollowMove(root: Action): ReactionMove {
  return { budget: root.cost?.AP ?? null }
}

// combat.tex "Evasion": on a hit, "take the attack normally and then use up
// to 2 AP to move if not interrupted"; on a graze, "jump to try to gain
// cover"; on a miss, "spend their movement surge immediately to escape or do
// the same as in the graze". The move is bought with the AP the reflex
// already paid; a miss leaves how far to the surge, and so to the evader.
// One who declared they stay put gives the move up.
export function getEvasionMove(root: Action, reaction: ActionOf<'evasion'>): ReactionMove | null {
  if (root.kind !== 'shoot' || root.interruption !== 'none' || reaction.stay) return null
  const AP = reaction.cost?.AP ?? 0
  return { budget: root.roll?.degree === 'miss' ? null : AP, prepaid: AP }
}

// combat.tex "Avoiding an Explosion": "On a miss, they can move 2 AP after
// the explosion" — bought with the AP the reflex paid, and not at all by one
// the blast interrupted (combat.tex "Interruption": "Movement is
// cancelled").
export function getEscapeAfterBlast(state: CombatState, root: BlastAction, reaction: ActionOf<'avoidExplosion'>): ReactionMove | null {
  if (reaction.roll?.degree !== 'miss') return null
  const reactor = state.characters[reaction.actorId]
  const hit = root.facts?.[reaction.actorId] ?? []
  if (reactor && hit.some((d) => (outcomeOf(d, reactor)?.interruption ?? 'none') !== 'none')) return null
  return { budget: 2, prepaid: reaction.cost?.AP ?? 0 }
}
