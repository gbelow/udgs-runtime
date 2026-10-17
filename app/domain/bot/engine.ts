import type { SceneState } from '../scene/types'
import type { Dice } from '../play/dice'
import { getAction, getHistory, getOpenAction } from '../scene/rules/log'
import { getTurnHolder, hasAgreedToEnd } from '../scene/rules/turn'
import { stepOpen, type Answerer } from './open'
import { findParty, getLiveFoes, isMember, type Party } from './party'
import { stepRoundChange } from './table'
import { andThen, ifChanged, play, type Played } from './move'

// What a bot does with the table, whatever its way of choosing: take the
// next step of whoever owes one. How it chooses is a policy — what the
// character does with its turn, and how it answers.

// The character's turn action, or null to do nothing and hold.
export type TurnChooser = (state: SceneState, parties: readonly Party[], party: Party, id: string, dice: Dice, newId: () => string) => Played | null

export type Policy = { turn: TurnChooser; answer: Answerer }

// Holding is passing for the rest of the round with what AP is left, kept to
// defend with.
export function hold(state: SceneState, id: string): Played | null {
  const ended = play(state, [{ kind: 'endTurn', args: [] }], () => 0, () => '')
  return ended.state === state ? null : andThen(ended, play(ended.state, [{ kind: 'toggleAgreeToEnd', args: [id] }], () => 0, () => ''))
}

// One step of the parties under the policy: what the character holding the
// turn does, or the open action's next step, or the next turn taken. Null when
// nothing is owed by a bot.
export function stepWith(policy: Policy, state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string): Played | null {
  const open = getOpenAction(state)
  const next = open ? stepOpen(state, parties, open, dice, newId, policy.answer) : stepIdle(policy, state, parties, dice, newId)
  return next ? ifChanged(state, next) : null
}

// Who is asked first to take a turn: the party after the one whose action
// landed last, so that turns alternate; at the start of the fight, whoever the
// die says. (play.tex "Combat": "first to ask, first to play" — nobody asks
// for ever, and no party is first by being listed first.)
function startOrder(state: SceneState, parties: readonly Party[], dice: Dice): readonly Party[] {
  const history = getHistory(state)
  const lastId = history.at(-1)
  const actor = lastId ? getAction(state, lastId)?.actorId : undefined
  const last = actor ? parties.findIndex((p) => isMember(p, actor)) : -1
  const first = last >= 0 ? last + 1 : history.length === 0 ? dice(false) % parties.length : 0
  return [...parties.slice(first % parties.length), ...parties.slice(0, first % parties.length)]
}

function stepIdle(policy: Policy, state: SceneState, parties: readonly Party[], dice: Dice, newId: () => string): Played | null {
  const changed = stepRoundChange(state, dice, (id) => findParty(parties, id) !== undefined)
  if (changed) return changed
  const holder = getTurnHolder(state)
  if (holder) {
    const party = findParty(parties, holder)
    return party ? (policy.turn(state, parties, party, holder, dice, newId) ?? hold(state, holder)) : null
  }

  for (const party of startOrder(state, parties, dice)) {
    if (getLiveFoes(state, party).length === 0) continue
    for (const id of party.members) {
      if (!state.characters[id] || hasAgreedToEnd(state, id)) continue
      const turn = play(state, [{ kind: 'startTurn', args: [id] }], dice, newId)
      const acted = turn.state !== state ? policy.turn(turn.state, parties, party, id, dice, newId) : null
      if (acted) return andThen(turn, acted)
    }
  }

  const waiting = parties.flatMap((p) => p.members).find((id) => state.characters[id] && !hasAgreedToEnd(state, id))
  return waiting ? play(state, [{ kind: 'toggleAgreeToEnd', args: [waiting] }], dice, newId) : null
}
