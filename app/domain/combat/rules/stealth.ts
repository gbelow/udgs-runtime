import type { Action, CombatState } from '../types'
import { STEALTH_MELEE_PENALTY, STEALTH_MOVEMENT_PENALTY, STEALTH_RANGED_PENALTY } from '../../tables'
import { getSenseReaches } from './detection'
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
  const test = state.heldTests.find((t) => t.id === id && t.kind === 'stealth')
  return test?.roll ? test.roll.score + test.spent : null
}

// combat.tex "Stealth in combat": "Enemies cannot target the character unless
// their detection is higher than the stealth value (a miss in stealth), and
// cannot react to them if their detection is not 4 points lower, at most (a
// graze in stealth)." A character not in stealth is detected.
export type Notice = 'detected' | 'sensed' | 'unnoticed'

// combat.tex "Attacking from stealth": "Being attacked automatically causes
// detection through touch after the attack, which means that a second attack
// can always be reacted to."
function hasBeenStruckBy(state: CombatState, observerId: string, targetId: string): boolean {
  return state.struck.some((s) => s.id === observerId && s.by === targetId)
}

// What the observer makes of the target: by the best sense that reaches it,
// against the stealth value less what `event` takes off it, if it is an action
// of the target's yet to land. A grapple partner is touching them, which "is
// immediately detected".
export function getNotice(state: CombatState, observerId: string, targetId: string, event: Action | null = null): Notice {
  const value = getStealthValue(state, targetId)
  if (value === null || getPartners(state, observerId).includes(targetId)) return 'detected'
  const pending = event && event.step !== 'done' ? getStealthPenalty(event) : 0
  const detections = getSenseReaches(state, observerId, targetId).map((r) => r.detection)
  const degree = detections.length === 0 ? 'hit' : getDegree(value + pending, Math.max(...detections))
  const noticed: Notice = degree === 'miss' ? 'detected' : degree === 'graze' ? 'sensed' : 'unnoticed'
  return noticed === 'unnoticed' && hasBeenStruckBy(state, observerId, targetId) ? 'sensed' : noticed
}
