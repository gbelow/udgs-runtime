import type { SceneState } from '../types'
import { getSeenBy, getVisibleActions } from '../rules/seen'
import { getPublicFace } from '../../character/lenses/face'
import { hide, keep, prune, type Censor, type Hidden } from '../../prune'

// The fight as a viewer who controls some of its characters is shown it
// (multiplayer-plan.md "Hidden information"): a fight that is valid on its
// own, with whoever they do not see nowhere in it, by id or by name.

type Context = { state: SceneState; controlled: ReadonlySet<string>; hidden: Hidden; visible: ReadonlySet<string> }
type SceneCensor<V> = Censor<V, Context>

const unseen = <V>(value: V, c: Context): V => prune(value, c.hidden)
const nobody: SceneCensor<string> = (id, c) => (c.hidden.has(id) ? '' : id)

const onlyShown = <V extends Record<string, unknown>>(value: V, c: Context): V =>
  prune(Object.fromEntries(Object.entries(value).filter(([id]) => c.visible.has(id))), c.hidden) as V

// Every field of the fight says how it is hidden, so that one added does not
// compile until it does.
const CENSORS: { [K in keyof SceneState]: SceneCensor<SceneState[K]> } = {
  // a die waits on its roller's screen; a call for an unseen roller is not shown
  calls: (calls, c) => {
    const kept = Object.entries(calls).filter(([, call]) => !c.hidden.has(call.roller))
    return kept.length === Object.keys(calls).length ? calls : Object.fromEntries(kept)
  },
  resume: unseen,
  // a character the viewer sees but does not play shows as a token
  characters: (characters, c) => unseen(Object.fromEntries(Object.entries(characters).filter(([id]) => !c.hidden.has(id)).map(([id, ch]) => [id, c.controlled.has(id) ? ch : getPublicFace(ch)])), c),
  // a party with none of its members seen is not shown
  parties: (parties, c) => {
    const shown = new Set(Object.entries(c.state.partyOf).filter(([id]) => !c.hidden.has(id)).map(([, party]) => party))
    const kept = Object.entries(parties).filter(([id]) => shown.has(id))
    return kept.length === Object.keys(parties).length ? parties : Object.fromEntries(kept)
  },
  partyOf: unseen,
  round: keep,
  elapsed: keep,
  chase: keep,
  inTurnCharacter: nobody,
  turn: keep,
  turnsBegun: keep,
  contenders: unseen,
  lastContest: unseen,
  agreedToEnd: unseen,
  roundStep: keep,
  concentration: unseen,
  morale: unseen,
  compulsions: unseen,
  // a stealth value is its hider's alone
  heldTests: (tests, c) => unseen(tests.filter((t) => t.kind !== 'stealth' || c.controlled.has(t.id)), c),
  turnsTaken: unseen,
  prepared: (ids, c) => ids.filter((id) => c.visible.has(id)),
  stealthTurns: (turns, c) => unseen(turns.filter((t) => c.controlled.has(t.id)), c),
  bodyCover: unseen,
  pressure: unseen,
  // the table's judgment of how the fight weighs on each party
  tablePressure: hide({}),
  surrendered: unseen,
  fleeing: keep,
  forcedSurge: nobody,
  breakage: keep,
  turnQueue: unseen,
  fleers: unseen,
  actions: onlyShown,
  live: (ids, c) => ids.filter((id) => c.visible.has(id)),
  stack: (ids, c) => ids.filter((id) => c.visible.has(id)),
  landed: (ids, c) => ids.filter((id) => c.visible.has(id)),
  logSaved: keep,
  names: unseen,
  journal: (entries, c) => entries.filter((e) => c.visible.has(e.action.id)).map((e) => { const action = prune(e.action, c.hidden); return action === e.action ? e : { ...e, action } }),
  edits: (edits, c) => edits.map((e) => { const changes = unseen(e.changes, c); return changes === e.changes ? e : { ...e, changes } }).filter((e) => e.changes.length > 0),
  board: (board, c) => (board ? { ...board, placements: unseen(board.placements, c) } : board),
  binds: unseen,
  floor: keep,
}

// The fight as the viewer sees it: all of it for the GM, who sees everything
// (`everything`), and otherwise without the characters and the log they are
// not shown.
export function getSceneSeenBy(state: SceneState, controlled: ReadonlySet<string>, everything = false): SceneState {
  if (everything) return state
  const seen = getSeenBy(state, controlled)
  const hidden = new Set(Object.keys(state.characters).filter((id) => !seen.has(id)))
  if (hidden.size === 0 && Object.keys(state.characters).every((id) => controlled.has(id))) return state
  const context: Context = { state, controlled, hidden, visible: getVisibleActions(state, controlled, seen) }
  const entries = Object.entries(CENSORS) as [keyof SceneState, SceneCensor<unknown>][]
  return Object.fromEntries(entries.map(([key, censor]) => [key, censor(state[key], context)])) as SceneState
}
