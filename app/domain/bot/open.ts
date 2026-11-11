import type { SceneState, RootAction } from '../scene/types'
import type { Dice } from '../play/dice'
import { getOpenAction } from '../scene/rules/log'
import { getAwaited } from '../scene/rules/options'
import { answerOpen } from './answer'
import { bestOpportunity, getAnswerWorth, type Settle } from './opportunity'
import { findParty, type Party } from './party'
import { passUp, tableMove } from './table'
import { play, type Played } from './move'
import { getReachableCells } from '../scene/rules/board/reach'
import { getAim } from '../scene/rules/aim'

// What a bot owes the action being played out, and the playing out of one.

// How the parties answer the committed action: the move that declares one,
// or null.
export type Answerer = (state: SceneState, parties: readonly Party[], open: RootAction, newId: () => string) => Played | null

// The cheapest defense, unweighed, from anyone.
export const defendOnly: Answerer = (state, parties, open, newId) => {
  for (const party of parties) {
    const answered = answerOpen(state, party, open, newId)
    if (answered) return answered
  }
  return null
}

// The exchange the committed action opened, played to its end with everyone
// defending by reflex alone: for weighing an opportunity attack.
export function settleWith(parties: readonly Party[], newId: () => string): Settle {
  return (state, dice) => playOut(state, parties, dice, newId, [], defendOnly)
}

// How a party answers by reflex, from everyone but those named: the cheapest
// defense, unweighed; where an opportunity attack the exchange comes out
// better with is offered as well, whichever of the two the same reckoning
// (opportunity.ts) says is worth more.
export function reflexAnswer(skip: readonly string[] = []): Answerer {
  return (state, parties, open, newId) => {
    for (const party of parties) {
      const settle = settleWith(parties, newId)
      const defense = answerOpen(state, party, open, newId, skip)
      const opportunity = bestOpportunity(state, party, open, newId, settle, skip)
      if (opportunity && defense) {
        const defender = String(defense.move[0]?.args[0] ?? '')
        return getAnswerWorth(state, party, defender, defense.state, settle) >= opportunity.worth ? defense : opportunity.played
      }
      const answered = defense ?? opportunity?.played
      if (answered) return answered
    }
    return null
  }
}

export function stepOpen(state: SceneState, parties: readonly Party[], open: RootAction, dice: Dice, newId: () => string, answer: Answerer): Played | null {
  const owner = findParty(parties, open.actorId)
  switch (open.step) {
    case 'define':
      return owner ? settleDeclared(state, open, dice, newId) : null
    case 'react':
      return answer(state, parties, open, newId) ?? (owner && !isAnswerOwed(state, parties) ? play(state, [{ kind: 'rollOrPay', args: [] }], dice, newId) : null)
    case 'post':
      return owner ? settleRolled(state, open, dice, newId) : null
    case 'done':
    case 'held':
      return null
  }
}

// What a bot finds still declared and not committed: taken to its commit, or
// passed up.
function settleDeclared(state: SceneState, open: RootAction, dice: Dice, newId: () => string): Played {
  if (open.kind === 'move' && open.forced) return walkForced(state, open, dice, newId)
  if (open.spawnedBy) return passUp(state, open, dice, newId)
  const committed = play(state, [{ kind: 'commit', args: [] }], dice, newId)
  return committed.state !== state ? committed : passUp(state, open, dice, newId)
}

// A movement the rules force, which may not be passed up: taken to the first
// space it reaches.
function walkForced(state: SceneState, open: RootAction, dice: Dice, newId: () => string): Played {
  const there = open.kind === 'move' ? getReachableCells(state, open)[0] : undefined
  return there ? play(state, [{ kind: 'click', args: [{ on: 'cell', cell: there.cell }, null, false, null] }, { kind: 'commit', args: [] }], dice, newId) : { move: [], state }
}

// What a bot does with its rolled action: puts a defender its crash displaces
// in the first space it may, else lands it.
function settleRolled(state: SceneState, open: RootAction, dice: Dice, newId: () => string): Played {
  const aim = getAim(state, open)
  const cell = aim?.field === 'displace' ? aim.cells[0] : undefined
  return play(state, [cell ? { kind: 'click', args: [{ on: 'cell', cell }, null, false, null] } : { kind: 'resolve', args: [] }], dice, newId)
}

// Whether the committed action still waits on anyone no bot controls
// (`getAwaited`): the die waits for them, and for whoever presses it.
function isAnswerOwed(state: SceneState, parties: readonly Party[]): boolean {
  return getAwaited(state).some((id) => !findParty(parties, id))
}

// The open action played to its end, everyone answering by reflex bar `skip`,
// the table pressing what nobody owes. For trying an option out on a copy.
export function playOut(state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string, skip: readonly string[] = [], answer: Answerer = reflexAnswer(skip)): SceneState {
  let current = state
  for (let i = 0; i < 30; i++) {
    const open = getOpenAction(current)
    if (!open) return current
    const next = stepOpen(current, parties, open, dice, newId, answer) ?? tableMove(current, parties, dice, newId)
    if (!next || next.state === current) return current
    current = next.state
  }
  return current
}
