import type { Action, CombatState } from '../types'
import { STEALTH_MELEE_PENALTY, STEALTH_MOVEMENT_PENALTY, STEALTH_RANGED_PENALTY } from '../../tables'
import { getSenseReaches } from './detection'
import { getHeldRoll } from './heldRoll'
import { getPartners } from './partners'
import { getDegree } from './test'

// combat.tex "Stealth in combat": a character who began the round out of sight
// of every opponent's active senses makes one stealth test, and its score,
// less what they do afterwards, is the number every opponent's detection is
// held against.

// What a landed action takes off the stealth value (combat.tex "Stealth
// penalties"). Spellcasting "is naturally undetectable" (combat.tex
// "Guidelines on playing stealth"), so a cast takes nothing.
export function getStealthPenalty(action: Action): number {
  switch (action.kind) {
    case 'move':
      return STEALTH_MOVEMENT_PENALTY[action.movement]
    case 'strike':
      return STEALTH_MELEE_PENALTY
    case 'shoot':
    case 'throw':
      return STEALTH_RANGED_PENALTY
    default:
      return 0
  }
}

// The stealth value of a character in stealth: their test this round, less the
// penalty of everything they have done since it; null for one who made none.
export function getStealthValue(state: CombatState, id: string): number | null {
  const roll = getHeldRoll(state, id, 'stealth')
  if (!roll) return null
  const done = state.record.filter((a) => a.actorId === id && a.round === state.round)
  return roll.score + done.reduce((sum, a) => sum + getStealthPenalty(a), 0)
}

// combat.tex "Stealth in combat": "Enemies cannot target the character unless
// their detection is higher than the stealth value (a miss in stealth), and
// cannot react to them if their detection is not 4 points lower, at most (a
// graze in stealth)." A character not in stealth is detected.
export type Notice = 'detected' | 'sensed' | 'unnoticed'

// What the observer makes of the target: by the best sense that reaches it. A
// grapple partner is touching them, which "is immediately detected".
export function getNotice(state: CombatState, observerId: string, targetId: string): Notice {
  const value = getStealthValue(state, targetId)
  if (value === null || getPartners(state, observerId).includes(targetId)) return 'detected'
  const detections = getSenseReaches(state, observerId, targetId).map((r) => r.detection)
  if (detections.length === 0) return 'unnoticed'
  const degree = getDegree(value, Math.max(...detections))
  return degree === 'miss' ? 'detected' : degree === 'graze' ? 'sensed' : 'unnoticed'
}
