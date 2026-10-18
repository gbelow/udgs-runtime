import type { Action, SceneState } from '../types'
import { notices } from './stealth'
import { getSenseReaches } from './detection'

// What a viewer who controls some of the fight's characters is shown of it
// (multiplayer-plan.md "Hidden information"): the characters they see, and
// the exchanges of the log they are part of or watch.

// An exchange of more than this many characters (a blast, a crowd) is
// watched by whoever sees its actor; a smaller one only by whoever sees
// everyone in it.
const MANY = 3

// A root action and everything it opened or answered, with whoever took part.
export type Exchange = { ids: string[]; participants: Set<string>; actor: string }

// The fight's logged actions, landed, in play or withdrawn, grouped by the
// root they come of.
export function getExchanges(state: SceneState): Map<string, Exchange> {
  const all = new Map<string, Action>()
  for (const a of Object.values(state.actions)) all.set(a.id, a)
  for (const e of state.journal) if (!all.has(e.action.id)) all.set(e.action.id, e.action)
  const rootOf = (a: Action): Action => {
    const above = all.get(a.reactionTo ?? a.spawnedBy ?? a.followUpOf ?? '')
    return above && above !== a ? rootOf(above) : a
  }
  const exchanges = new Map<string, Exchange>()
  for (const a of all.values()) {
    const root = rootOf(a)
    const exchange = exchanges.get(root.id) ?? { ids: [], participants: new Set<string>(), actor: root.actorId }
    exchange.ids.push(a.id)
    for (const id of a.participants) exchange.participants.add(id)
    exchanges.set(root.id, exchange)
  }
  return exchanges
}

// Whether the observer has the target to aim at: an active sense takes them
// in, and their stealth value, if they have one, does not hold against it.
export function canSee(state: SceneState, observerId: string, targetId: string): boolean {
  return getSenseReaches(state, observerId, targetId).some((r) => r.active) && notices(state, observerId, targetId)
}

// The characters a viewer sees: their own, those any of them detects, and
// whoever shares an exchange with one of theirs — an unseen archer has been
// seen by whoever they shot.
export function getSeenBy(state: SceneState, controlled: ReadonlySet<string>): Set<string> {
  const own = [...controlled].filter((id) => state.characters[id])
  const seen = new Set(own)
  for (const id of own) {
    for (const other of Object.keys(state.characters)) if (canSee(state, id, other)) seen.add(other)
  }
  for (const { participants } of getExchanges(state).values()) {
    if ([...participants].some((id) => controlled.has(id))) participants.forEach((id) => seen.add(id))
  }
  return seen
}

// The ids of the exchanges' actions the viewer is shown: those they are part
// of, those they see everyone of, and, of a crowd, those whose actor they see.
export function getVisibleActions(state: SceneState, controlled: ReadonlySet<string>, seen: ReadonlySet<string>): Set<string> {
  const visible = new Set<string>()
  for (const { ids, participants, actor } of getExchanges(state).values()) {
    const people = [...participants]
    const shown = people.some((id) => controlled.has(id))
      || (people.length > MANY ? seen.has(actor) : people.every((id) => seen.has(id) || !state.characters[id]))
    if (shown) ids.forEach((id) => visible.add(id))
  }
  return visible
}
