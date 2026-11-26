import type { Action, Change, SceneState } from '../types'
import { getFacesKnownBy, getSeenBy, getSensedBy, getVisibleActions } from '../rules/seen'
import type { CampaignCharacter } from '../../types'
import { UNSEEN_HOLDER, UNSEEN_NAME } from '../rules/contest'
import { getPublicFace } from '../../character/lenses/face'
import { hide, keep, prune, type Censor, type Hidden } from '../../prune'

// The fight as a viewer who controls some of its characters is shown it
// (multiplayer-plan.md "Hidden information"): a fight that is valid on its
// own, with whoever they do not see nowhere in it, by id or by name, but for
// what its log tells of a face they know.

// `hidden` is whoever is not seen now, `unknown` those of them whose face the
// viewer does not know either, and `masked` those seen in an exchange without
// having been detected: someone, with no face.
type Context = { state: SceneState; controlled: ReadonlySet<string>; hidden: Hidden; unknown: Hidden; masked: Hidden; visible: ReadonlySet<string> }
type SceneCensor<V> = Censor<V, Context>

const unseen = <V>(value: V, c: Context): V => prune(value, c.hidden)
const nobody: SceneCensor<string> = (id, c) => (c.hidden.has(id) ? '' : id)

// what the log tells, which still names a face the viewer knows
const told = <V>(value: V, c: Context): V => prune(value, c.unknown)

// Where something went is written down in words, by whose hands it was in, so
// a line about someone of `hidden` is left out whole.
function withoutNamed(changes: Change[], hidden: Hidden, state: SceneState): Change[] {
  if (hidden.size === 0 || changes.length === 0) return changes
  const names = [...hidden].flatMap((id) => (state.names[id] ? [state.names[id]] : []))
  const kept = changes.filter((x) => x.kind !== 'move' || !names.some((n) => x.name === n || x.from.startsWith(`${n}'s `) || x.to.startsWith(`${n}'s `)))
  return kept.length === changes.length ? changes : kept
}

function toldAction(action: Action, c: Context): Action {
  const changes = withoutNamed(action.changes, c.unknown, c.state)
  return prune(changes === action.changes ? action : { ...action, changes }, c.unknown)
}

const shownActions: SceneCensor<SceneState['actions']> = (actions, c) =>
  Object.fromEntries(Object.entries(actions).flatMap(([id, a]) => (c.visible.has(id) ? [[id, toldAction(a, c)]] : [])))

// Someone seen in an exchange whose face is not known.
const masks = new WeakMap<CampaignCharacter, CampaignCharacter>()
function maskOf(character: CampaignCharacter): CampaignCharacter {
  let mask = masks.get(character)
  if (!mask) masks.set(character, (mask = { ...getPublicFace(character), name: UNSEEN_NAME, token: '' }))
  return mask
}

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
  characters: (characters, c) => unseen(Object.fromEntries(Object.entries(characters).filter(([id]) => !c.hidden.has(id)).map(([id, ch]) => [id, c.controlled.has(id) ? ch : c.masked.has(id) ? maskOf(ch) : getPublicFace(ch)])), c),
  // a party with none of its members seen is not shown
  parties: (parties, c) => {
    const shown = new Set(Object.entries(c.state.partyOf).filter(([id]) => !c.hidden.has(id)).map(([, party]) => party))
    const kept = Object.entries(parties).filter(([id]) => shown.has(id))
    return kept.length === Object.keys(parties).length ? parties : Object.fromEntries(kept)
  },
  partyOf: unseen,
  spawnOf: keep,
  round: keep,
  elapsed: keep,
  chase: keep,
  chaseIntents: keep,
  followed: keep,
  inTurnCharacter: (id, c) => (c.hidden.has(id) ? UNSEEN_HOLDER : id),
  turn: keep,
  turnsBegun: keep,
  contenders: unseen,
  contestModes: unseen,
  lastContest: told,
  contestWindow: keep,
  contestSeconds: keep,
  contestDecideSeconds: keep,
  thinking: unseen,
  letGo: unseen,
  agreedToEnd: told,
  doneResting: unseen,
  roundStep: keep,
  concentration: unseen,
  morale: unseen,
  compulsions: unseen,
  // a stealth value is its hider's alone
  heldTests: (tests, c) => unseen(tests.filter((t) => t.kind !== 'stealth' || c.controlled.has(t.id)), c),
  turnsTaken: unseen,
  prepared: (ids, c) => ids.filter((id) => c.visible.has(id)),
  performed: (ids, c) => ids.filter((id) => c.visible.has(id)),
  protectionMoves: unseen,
  firstTurn: (first, c) => (first && c.hidden.has(first.id) ? null : first),
  following: unseen,
  againstAllies: unseen,
  againstAlliesOnce: unseen,
  stealthTurns: (turns, c) => unseen(turns.filter((t) => c.controlled.has(t.id)), c),
  bodyCover: unseen,
  pressure: unseen,
  // the table's judgment of how the fight weighs on each party
  tablePressure: hide({}),
  surrendered: unseen,
  surrenderers: unseen,
  compelledSurrender: unseen,
  braved: unseen,
  moraleRallies: unseen,
  dominations: unseen,
  mocked: (ids, c) => ids.filter((id) => c.visible.has(id)),
  fleeing: keep,
  forcedSurge: nobody,
  forcedBy: nobody,
  breakage: keep,
  turnQueue: unseen,
  fleers: unseen,
  actions: shownActions,
  live: (ids, c) => ids.filter((id) => c.visible.has(id)),
  stack: (ids, c) => ids.filter((id) => c.visible.has(id)),
  landed: (ids, c) => ids.filter((id) => c.visible.has(id)),
  logSaved: keep,
  foundAt: keep,
  // a seat's own memory, put in its view after the fight is seen
  remembered: keep,
  names: (names, c) => { const shown = told(names, c); return c.masked.size > 0 ? { ...shown, ...Object.fromEntries([...c.masked].map((id) => [id, UNSEEN_NAME])) } : shown },
  faces: (faces, c) => told(Object.fromEntries(Object.entries(faces).filter(([id]) => c.controlled.has(id))), c),
  witnessed: (by, c) => Object.fromEntries(Object.entries(by).flatMap(([id, who]) => (c.visible.has(id) ? [[id, who.filter((w) => c.controlled.has(w))]] : []))),
  journal: (entries, c) => entries.filter((e) => c.visible.has(e.action.id)).map((e) => { const action = toldAction(e.action, c); return action === e.action ? e : { ...e, action } }),
  edits: (edits, c) => edits.map((e) => { const changes = unseen(withoutNamed(e.changes, c.hidden, c.state), c); return changes === e.changes ? e : { ...e, changes } }).filter((e) => e.changes.length > 0),
  board: (board, c) => (board ? { ...board, placements: unseen(board.placements, c) } : board),
  binds: unseen,
  floor: unseen,
  opened: keep,
}

// The fight as the viewer sees it: all of it for the GM, who sees everything
// (`everything`), and otherwise without the characters and the log they are
// not shown.
export function getSceneSeenBy(state: SceneState, controlled: ReadonlySet<string>, everything = false): SceneState {
  if (everything) return state
  const byViewer = views.get(state) ?? new Map<string, SceneState>()
  views.set(state, byViewer)
  const key = [...controlled].sort().join('\n')
  const known = byViewer.get(key)
  if (known) return known
  const made = censor(state, controlled)
  byViewer.set(key, made)
  return made
}

// A state is replaced, never changed, so what a viewer is shown of it is made once.
const views = new WeakMap<SceneState, Map<string, SceneState>>()

function censor(state: SceneState, controlled: ReadonlySet<string>): SceneState {
  const seen = getSeenBy(state, controlled)
  const everyone = Object.keys(state.characters)
  const hidden = new Set(everyone.filter((id) => !seen.has(id)))
  const known = getFacesKnownBy(state, controlled)
  const sensed = getSensedBy(state, controlled)
  if (hidden.size === 0 && everyone.every((id) => controlled.has(id))) return state
  const unknown = new Set([...hidden].filter((id) => !known.has(id)))
  const masked = new Set([...seen].filter((id) => !sensed.has(id) && !known.has(id) && state.characters[id]))
  const context: Context = { state, controlled, hidden, unknown, masked, visible: getVisibleActions(state, controlled, seen) }
  const entries = Object.entries(CENSORS) as [keyof SceneState, SceneCensor<unknown>][]
  return Object.fromEntries(entries.map(([key, censor]) => [key, censor(state[key], context)])) as SceneState
}
