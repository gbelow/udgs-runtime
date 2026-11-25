import type { Action, SceneState } from '../types'
import { getStealthTurn, notices } from './stealth'
import { getSenseReaches } from './detection'
import { getLiveActions } from './log'
import { TOGETHER } from '../../prune'

// What a viewer who controls some of the fight's characters is shown of it
// (multiplayer-plan.md "Hidden information"): the characters they see, and
// the exchanges of the log they are part of or watch.

// An exchange of more than this many characters (a blast, a crowd) is
// watched by whoever sees its actor; a smaller one only by whoever sees
// everyone in it.
const MANY = 3

// A root action and everything it opened or answered, with whoever took part
// (`getInvolved`).
// `held`, those of them it holds together in a pair, whom it cannot be told
// without.
export type Exchange = { ids: string[]; participants: Set<string>; held: Set<string>; actor: string }

// What an action writes down of who only watched it, or let it go by.
const WATCHING: ReadonlySet<string> = new Set(['participants', 'detections', 'hiddenFrom', 'passed', 'unprotectedBy'])

// Who took part in an action: those it lists, but for whoever only watched it or
// let it go by, who is seen no better for it.
function getInvolved(action: Action): Involved {
  const known = involved.get(action)
  if (known) return known
  const named = new Set<string>()
  const together = new Set<string>()
  const walk = (value: unknown, pair: boolean): void => {
    if (typeof value === 'string') { named.add(value); if (pair) together.add(value) }
    else if (Array.isArray(value)) value.forEach((v) => walk(v, pair))
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) if (!WATCHING.has(key)) { named.add(key); walk(inner, TOGETHER.has(key)) }
    }
  }
  walk(action, false)
  const taking = action.participants.filter((id) => named.has(id))
  const made = { taking, held: taking.filter((id) => together.has(id)) }
  involved.set(action, made)
  return made
}

// An action is replaced, never changed.
type Involved = { taking: string[]; held: string[] }
const involved = new WeakMap<Action, Involved>()

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
    const exchange = exchanges.get(root.id) ?? { ids: [], participants: new Set<string>(), held: new Set<string>(), actor: root.actorId }
    exchange.ids.push(a.id)
    const { taking, held } = getInvolved(a)
    for (const id of taking) exchange.participants.add(id)
    for (const id of held) exchange.held.add(id)
    exchanges.set(root.id, exchange)
  }
  return exchanges
}

// Whether the observer has the target in sight: an active sense takes them
// in, or, in the target's own turn, any sense that answers (the table's
// ruling, 2026-11-21: an ear finds a hider as they act, `getBystanderDetections`),
// and their stealth value, if they have one, does not hold against it; or an
// action of theirs, while it is played out, was found by them as it was
// committed. Whom one may aim at is `notices`'s.
export function canSee(state: SceneState, observerId: string, targetId: string): boolean {
  if (isFoundActing(state, observerId, targetId)) return true
  const acting = getStealthTurn(state)?.id === targetId
  return getSenseReaches(state, observerId, targetId).some((r) => r.active || (acting && r.reactive)) && notices(state, observerId, targetId)
}

// combat.tex "Actions in stealth": the noise of an action finds its actor for
// whoever may react to it, before the turn counts it.
function isFoundActing(state: SceneState, observerId: string, targetId: string): boolean {
  return getLiveActions(state).some((a) => a.actorId === targetId && (a.step === 'react' || a.step === 'post')
    && a.detections.some((d) => d.found && d.observerId === observerId && d.hiderId === targetId))
}

// Whom each character detects, worked out once for the fight as it stands: a
// player's characters, and every screen and guest that shows the same fight,
// share it.
const sights = new WeakMap<SceneState, Map<string, Set<string>>>()

export function getSightOf(state: SceneState, observerId: string): ReadonlySet<string> {
  let ofState = sights.get(state)
  if (!ofState) sights.set(state, ofState = new Map())
  let sight = ofState.get(observerId)
  if (!sight) ofState.set(observerId, sight = new Set(Object.keys(state.characters).filter((other) => canSee(state, observerId, other))))
  return sight
}

// The characters a viewer sees now: their own, those any of them detects, and
// whoever shares an exchange in play with one of theirs, for as long as it is.
export function getSeenBy(state: SceneState, controlled: ReadonlySet<string>): Set<string> {
  const seen = getSensedBy(state, controlled)
  const live = new Set(state.live)
  for (const { ids, participants } of getExchanges(state).values()) {
    if (ids.some((id) => live.has(id)) && [...participants].some((id) => controlled.has(id))) participants.forEach((id) => seen.add(id))
  }
  return seen
}

// A viewer's own characters and those any of them detects.
export function getSensedBy(state: SceneState, controlled: ReadonlySet<string>): Set<string> {
  const own = [...controlled].filter((id) => state.characters[id])
  const seen = new Set(own)
  for (const id of own) getSightOf(state, id).forEach((other) => seen.add(other))
  return seen
}

// Whose face a viewer knows, seen now or not (the table's ruling: from the
// moment one of theirs detects it, for the rest of the fight): their own, their
// parties', and whoever one of theirs has detected.
export function getFacesKnownBy(state: SceneState, controlled: ReadonlySet<string>): Set<string> {
  const parties = new Set([...controlled].flatMap((id) => state.partyOf[id] ?? []))
  const known = new Set([...controlled, ...Object.keys(state.characters).filter((id) => parties.has(state.partyOf[id]))])
  for (const id of controlled) (state.faces[id] ?? []).forEach((other) => known.add(other))
  return known
}

// The ids of the exchanges' actions the viewer is shown: those they are part
// of, and those whose actor one of theirs took in as it was played
// (`SceneState.witnessed`). One nobody's witnesses were noted of goes by who is
// seen now: everyone in it, or, of a crowd, its actor.
export function getVisibleActions(state: SceneState, controlled: ReadonlySet<string>, seen: ReadonlySet<string>): Set<string> {
  const visible = new Set<string>()
  const known = getFacesKnownBy(state, controlled)
  for (const [root, { ids, participants, held, actor }] of getExchanges(state)) {
    const people = [...participants]
    const witnesses = state.witnessed[root]
    const shown = people.some((id) => controlled.has(id)) || (witnesses ? witnesses.some((id) => controlled.has(id))
      : people.length > MANY ? seen.has(actor) : people.every((id) => seen.has(id) || !state.characters[id]))
    if (shown && [...held].every((id) => seen.has(id) || known.has(id) || !state.characters[id])) ids.forEach((id) => visible.add(id))
  }
  return visible
}
