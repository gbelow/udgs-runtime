import type { Character } from '../../types'
import type { Action, ActionOf, Degree, MoveAction } from '../types'
import { MOVEMENT_KINDS } from '../../lists'
import { getMovementBlock } from '../../character/rules/movement'

// The moves a reaction opens for its reactor, as the fields of the move it
// opens: `budget` the most AP it may cost, `prepaid` what the reaction
// already paid towards it, and whatever kinds of movement it grants.
export type ReactionMove = Partial<Pick<MoveAction, 'movement' | 'movements' | 'budget' | 'prepaid' | 'surgeBudget' | 'forced'>>

// A tread an action carries, bought with the AP the action itself
// costs (combat.tex "Rest"; abilities.tex "Steady Arms").
export function getCarriedMove(AP: number): ReactionMove {
  return { movement: 'tread', movements: ['tread'], budget: AP, prepaid: AP }
}

// combat.tex "Avoiding an Explosion": "On a critical, the character can run
// once. On a hit, they can jump once in any direction before the explosion
// occurs. On a graze, they can move 1 AP before the explosion ... It is
// possible to downgrade the movement action. Movement stamina costs for
// running and jumping are standard." The reaction's 3 AP buys the move, as
// an evasion's does, so a run or a jump (2 AP a block) fits once; its STA
// is paid as usual. "On a miss, they don't move."
export function getEscapeBeforeBlast(reaction: ActionOf<'avoidExplosion'>, degree: Degree | null): ReactionMove | null {
  if (!degree) return null
  const AP = reaction.cost?.AP ?? 0
  switch (degree) {
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

// combat.tex "Evasion": the reflex's AP "is used to move and does not need
// to be spent again"; on a hit, "take the attack normally and then use up to
// 2 AP to move if not interrupted"; on a graze, "jump to try to gain cover";
// on a miss, "can spend their whole movement surge AP", on top of what the
// reflex paid (`surgeBudget`). One any of the shots interrupted is offered
// none (commands/sequence.ts `getFollowUps`).
export function getEvasionMove(root: Action, reaction: ActionOf<'evasion'>): ReactionMove | null {
  if (root.kind !== 'shoot') return null
  const AP = reaction.cost?.AP ?? 0
  return { budget: AP, prepaid: AP, surgeBudget: root.roll?.degree === 'miss' }
}

// combat.tex "Trample": an evade "allows 1 AP of walking", bought with the AP
// it paid (rules/sidestep.ts); forced on an evader whose space the mover ends in.
export function getSidestepMove(c: Character, paid: number, forced: boolean): ReactionMove {
  return { movement: 'walk', movements: ['walk'], budget: getMovementBlock(c, 'walk').AP, prepaid: paid, forced }
}
