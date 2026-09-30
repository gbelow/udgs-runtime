import type { Action, ActionOf, BlastAction, CombatState, MoveAction } from '../types'
import { MOVEMENT_KINDS } from '../../lists'
import { outcomeOf } from './damage'
import { getShotGroup } from './coordinated'

// The moves a reaction opens for its reactor, as the fields of the move it
// opens: `budget` the most AP it may cost, `prepaid` what the reaction
// already paid towards it, and whatever kinds of movement it grants.
export type ReactionMove = Partial<Pick<MoveAction, 'movement' | 'movements' | 'budget' | 'prepaid'>>

// combat.tex "Avoiding an Explosion": "On a critical, the character can run
// once. On a hit, they can jump once in any direction before the explosion
// occurs. On a graze, they can move 1 AP before the explosion ... It is
// possible to downgrade the movement action. Movement stamina costs for
// running and jumping are standard." The reaction's 3 AP buys the move, as
// an evasion's does, so a run or a jump (2 AP a block) fits once; its STA
// is paid as usual. A miss moves after the blast instead
// (`getEscapeAfterBlast`).
export function getEscapeBeforeBlast(reaction: ActionOf<'avoidExplosion'>): ReactionMove | null {
  if (!reaction.roll) return null
  const AP = reaction.cost?.AP ?? 0
  switch (reaction.roll.degree) {
    case 'critical': return { budget: AP, prepaid: AP, movement: 'run', movements: [...MOVEMENT_KINDS] }
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
// already paid; the escape on a miss is a flee (rules/flee.ts
// `getFleersOf`). One who declared they stay put gives the move up.
// combat.tex "Coordinated Shots": the shots land together, so any of them
// interrupting the evader takes the move away.
export function getEvasionMove(state: CombatState, root: Action, reaction: ActionOf<'evasion'>): ReactionMove | null {
  if (root.kind !== 'shoot' || getShotGroup(state, root).some((shot) => shot.interruption !== 'none') || reaction.stay) return null
  const AP = reaction.cost?.AP ?? 0
  return { budget: AP, prepaid: AP }
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
