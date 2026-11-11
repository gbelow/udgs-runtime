import type { Action, SceneState } from '../scene/types'
import { getPayableCost } from '../scene/rules/action'
import { getLiveReactionsTo, getOpenAction } from '../scene/rules/log'
import { declareDefense, getDefenseOptions } from './answer'
import { getLiveFoes, isOnSide, type Party, type Tuning } from './party'
import { getOpportunities } from './opportunity'
import { settleWith } from './open'
import { expectedLoss } from './value'

// What the attack a character has just committed is worth before any die is
// weighed against the fight: the damage it takes from its target on average
// over the die, and the AP its target pays to answer it. The target answers as
// it would weigh it: of no defense and each defense open to it, the one that
// leaves the attacker the least. Zero for an option that is not an attack on a
// foe.

function apOf(state: SceneState, action: Action): number {
  return getPayableCost(state, action)?.AP ?? 0
}

type Answer = { state: SceneState; spent: number; surged: boolean }

// The attack the character has committed on a foe, and every defense its
// target could still declare against it.
function getAnswers(state: SceneState, party: Party, actorId: string, newId: () => string): { targetId: string; answers: Answer[] } | null {
  const open = getOpenAction(state)
  if (!open || open.actorId !== actorId || open.targetId === null || isOnSide(state, party, open.targetId)) return null
  const targetId = open.targetId
  const answers = getDefenseOptions(state, targetId, open).flatMap((option): Answer[] => {
    const declared = declareDefense(state, targetId, open, option, newId)
    const reaction = declared && getLiveReactionsTo(declared, open.id).find((r) => r.actorId === targetId)
    return declared && reaction ? [{ state: declared, spent: apOf(declared, reaction), surged: option.surge !== null }] : []
  })
  return { targetId, answers }
}

// combat.tex "Opportunity Attack": a foe's opportunity attack on the attack,
// one the foe's own reckoning says is worth making (opportunity.ts), answers
// it too. It lands first, and the attack may come to nothing, so what the
// attack takes is read from the exchange played out with it, the dice at a
// middling and at a high value, not from the preview.
const DICE = [4, 9]

function getOpportunityAnswers(state: SceneState, parties: readonly Party[], party: Party, targetId: string, newId: () => string): number[] {
  const open = getOpenAction(state)
  const target = state.characters[targetId]
  if (!open || !target) return []
  const foes: Party = { members: getLiveFoes(state, party) }
  const settle = settleWith(parties, newId)
  const before = target.injuries.injuryLevel
  return foes.members.flatMap((foe) => getOpportunities(state, foes, foe, open, newId, settle)
    .filter((o) => o.worth > 0)
    .map((o) => DICE.reduce((sum, die) => sum + Math.max(0, (settle(o.played.state, () => die).characters[targetId]?.injuries.injuryLevel ?? before) - before), 0) / DICE.length / target.injuries.deathThreshold))
}

export function getExchange(state: SceneState, parties: readonly Party[], party: Party, actorId: string, tuning: Tuning, newId: () => string): number {
  const found = getAnswers(state, party, actorId, newId)
  if (!found) return 0
  const gained = [{ state, spent: 0, surged: false }, ...found.answers].map((a) => tuning.exchange * expectedLoss(a.state, found.targetId) + tuning.drain * a.spent)
  const opportunities = getOpportunityAnswers(state, parties, party, found.targetId, newId).map((taken) => tuning.exchange * taken)
  return Math.min(...gained, ...opportunities)
}

// Whether the attack the character has just committed on a foe has a target
// with a defense left to answer it with: any, or only one its own AP pays for
// when `surges` is false (a defense that takes a reaction surge does not count).
export function isAnswerable(state: SceneState, party: Party, actorId: string, surges: boolean, newId: () => string): boolean {
  return (getAnswers(state, party, actorId, newId)?.answers.filter((a) => surges || !a.surged).length ?? 0) > 0
}
