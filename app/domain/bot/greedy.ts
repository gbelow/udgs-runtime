import { getApproachCandidates, getAttackCandidates, type Candidate } from './candidates'
import type { Policy, TurnChooser } from './engine'
import { reflexAnswer } from './open'

// The bot that does not weigh: it takes the first attack it has (the hardest
// hitting variation on the most wounded foe in reach), else walks towards the
// foes, and answers by the cheapest defense. It plays the fights an option is
// looked at through.

function firstPlayed(candidates: Candidate[], dice: Parameters<Candidate['play']>[0]) {
  for (const candidate of candidates) {
    const played = candidate.play(dice)
    if (played) return played
  }
  return null
}

// The walk is only looked for when there is nothing to attack.
const greedyTurn: TurnChooser = (state, _parties, party, id, dice, newId) =>
  firstPlayed(getAttackCandidates(state, party, id, newId), dice) ?? firstPlayed(getApproachCandidates(state, party, id, newId), dice)

export const GREEDY: Policy = { turn: greedyTurn, answer: reflexAnswer() }
