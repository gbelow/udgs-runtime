import type { CampaignCharacter } from '../../types'
import type { SceneState } from '../types'
import { hasGrant } from '../../character/rules/effects'
import { getPrepared } from './prepared'
import { holdsThroughRound } from './roundChange'

// The Stoicism abilities (abilities.json, section "Stoicism") that work on the
// fight as it stands. Contemplation is the morale test's compulsion
// (rules/morale.ts `getMoraleOutcome`), Measured the safe tests it allows
// (character/rules/effects.ts `getRollModes`), Flow State II the focus
// surge's AP (a buff).

// combat.tex "Interruption": "The AP from the interrupted action is
// refunded, but 1 AP is lost". abilities.json "Reserve Clause": "When they
// give up an action, they get back all of its AP instead of AP-1."
export function getGiveUpLoss(c: CampaignCharacter | undefined): number {
  return c && hasGrant(c, 'reserveClause') ? 0 : 1
}

// abilities.json "First Mover": "Gains +1 AP when the character is the first
// to take their turn in a round."
export function getFirstMoverAP(c: CampaignCharacter | undefined): number {
  return c && hasGrant(c, 'firstMover') ? 1 : 0
}

// abilities.json "Flow State": "Gains 1 AP when maintaining concentration
// from one round to the other": taken off what holding on costs at the round
// change, its upkeep first and then the held action (the table's ruling).
export function getHoldOnDiscount(c: CampaignCharacter | undefined): number {
  return c && hasGrant(c, 'flowState') ? 1 : 0
}

// abilities.json "Stoic's Attitudes": "each turn that they do not prepare any
// action, except when concentrating": the holder's turn, with no preparation
// of theirs landed in it, while they hold nothing through the round.
export function isUnpreparedTurn(state: SceneState, holder: string): boolean {
  return !getPrepared(state).some((p) => p.actorId === holder && p.turn === state.turn) && !holdsThroughRound(state, holder)
}
