import type { SceneState } from '../scene/types'
import type { Dice } from '../play/dice'
import { getOpenAction } from '../scene/rules/log'
import { getAvailableActions } from '../scene/rules/options'
import { getReachableCells } from '../scene/rules/board/reach'
import { getPathPlacements } from '../scene/rules/board/waypoint'
import { withPlacements } from '../scene/rules/board/board'
import { amendAction, declareAction } from '../scene/commands/action'
import { committing, getApproachCandidates, getAttackCandidates, getReadAttackCandidates, type Candidate } from './candidates'
import type { Policy } from './engine'
import { reflexAnswer } from './open'
import { getLiveFoes, type Party } from './party'
import { walkMove } from './position'
import type { Played } from './move'

// The bot that does not weigh: it takes the attack the quick reading puts
// first (candidates.ts `getReadAttackCandidates`), else the first attack it
// has, else walks towards the foes, and answers by the cheapest defense. An
// attack that would draw a foe's opportunity attack (combat.tex "Opportunity
// Attack") waits for a step out of reach first, where one is free of them
// and leaves the attack to be made from there. It plays the fights an option
// is looked at through.

function firstPlayed(candidates: Candidate[], dice: Dice): Played | null {
  for (const candidate of candidates) {
    const played = candidate.play(dice)
    if (played) return played
  }
  return null
}

// Whether a foe is offered an opportunity attack on the character's action,
// committed and waiting for answers.
function drawsOpportunity(state: SceneState, party: Party, id: string): boolean {
  const open = getOpenAction(state)
  if (!open || open.actorId !== id || open.step !== 'react') return false
  return getLiveFoes(state, party).some((foe) => getAvailableActions(state, foe).some((o) => o.available && o.draft.kind === 'opportunityAttack'))
}

// A walk of one step that draws no opportunity attack, to a cell the attack
// the reading puts first can be made from without drawing one either.
function stepClear(state: SceneState, party: Party, id: string, dice: Dice, newId: () => string): Played | null {
  const declared = declareAction(id, { kind: 'move' }, newId)(state)
  const moving = amendAction({ movement: 'basic' })(declared)
  const aimed = getOpenAction(moving)
  const c = state.characters[id]
  if (aimed?.kind !== 'move' || !c) return null
  for (const to of getReachableCells(moving, aimed).filter((cell) => cell.steps === 1)) {
    const walk = committing(state, id, walkMove(id, 'basic', to.path), newId)(dice)
    const at = getPathPlacements(moving, aimed, to.path).at(-1)
    if (!walk || !at || drawsOpportunity(walk.state, party, id)) continue
    const moved = withPlacements(state, { [id]: at })
    const there = { ...moved, characters: { ...moved.characters, [id]: { ...c, resources: { ...c.resources, AP: c.resources.AP - to.cost.AP, STA: c.resources.STA - to.cost.STA } } } }
    const attack = firstPlayed(getReadAttackCandidates(there, party, id, newId), dice)
    if (attack && !drawsOpportunity(attack.state, party, id)) return walk
  }
  return null
}

function greedyTurn(state: SceneState, party: Party, id: string, dice: Dice, newId: () => string): Played | null {
  const attack = firstPlayed(getReadAttackCandidates(state, party, id, newId), dice)
  if (attack && drawsOpportunity(attack.state, party, id)) return stepClear(state, party, id, dice, newId) ?? attack
  return attack
    ?? firstPlayed(getAttackCandidates(state, party, id, newId), dice)
    ?? firstPlayed(getApproachCandidates(state, party, id, newId), dice)
}

// The walk is only looked for when there is nothing to attack.
export const GREEDY: Policy = {
  turn: (state, _parties, party, id, dice, newId) => greedyTurn(state, party, id, dice, newId),
  answer: reflexAnswer(),
}
