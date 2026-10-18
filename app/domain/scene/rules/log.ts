import { getDiceBar } from '../../play/calls'
import type { Action, ActionKind, ActionOf, SceneState, OpportunityAction, RootAction } from '../types'
import { isRootAction } from './actionCatalog'

// The fight's log of actions: which one is open, what answers what, and
// what opened what.

// The kinds whose participants are not simply whoever their record names: the
// characters such a kind involves, which are noted in place of the ones its
// record would give.
const SPECIFIC_PARTICIPANTS: { [K in ActionKind]?: (state: SceneState, action: ActionOf<K>) => string[] } = {}

// Every character of the fight an action involves, the ones it already notes
// kept: what its kind says if it says (`SPECIFIC_PARTICIPANTS`), otherwise
// whoever its record names in any field � declared by, aimed at, reached,
// tested, protected, passed or held.
export function getParticipants(state: SceneState, action: Action): string[] {
  const specific = SPECIFIC_PARTICIPANTS[action.kind] as ((state: SceneState, action: Action) => string[]) | undefined
  const found = new Set([...action.participants, ...(specific ? specific(state, action) : getNamed(state, action))])
  return found.size === action.participants.length ? action.participants : [...found]
}

function getNamed(state: SceneState, action: Action): string[] {
  const named: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === 'string') { if (state.characters[value]) named.push(value) }
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key !== 'participants') { walk(key); walk(inner) }
      }
    }
  }
  walk(action)
  return named
}

// The action being played out: the top of the stack. Nothing can be declared
// while one is open, so there is only ever one root — except for the actions
// a reaction opens (an opportunity attack, a follow, an escape from a blast),
// which are pushed over whatever they were opened against and played out
// first: an opportunity attack on a mover is fought while the move waits to
// resolve, and an explosion a cast opened waits for the escapes its own
// reactions opened.
export function getOpenAction(state: SceneState): RootAction | null {
  const id = state.stack.at(-1)
  const open = id ? getAction(state, id) : null
  return open && isRootAction(open) ? open : null
}

// Why the fight cannot move past what is under way: a die it waits on, or
// anything still on the stack, whatever is on top.
export function getPlayingOutBar(state: SceneState): string | null {
  return getDiceBar(state.calls) ?? (state.stack.length > 0 ? 'an action is being played out' : null)
}

// The first root of the kind still being played out — waiting on what it
// opened, or on its own resolve — that `match` accepts, from the bottom of
// the stack up.
export function findOpenRoot<K extends ActionKind>(state: SceneState, kind: K, match: (a: ActionOf<K>) => boolean = () => true): ActionOf<K> | null {
  for (const id of state.stack) {
    const action = getAction(state, id)
    if (action?.kind === kind && match(action as ActionOf<K>)) return action as ActionOf<K>
  }
  return null
}

// Every action of the fight, played out or not: what landed, then what is
// still in play.
export function getLog(state: SceneState): Action[] {
  return [...getLanded(state), ...getLiveActions(state)]
}

// The actions still in play, in the order they were declared.
export function getLiveActions(state: SceneState): Action[] {
  return state.live.map((id) => state.actions[id])
}

// The actions played out, in the order they landed.
export function getLanded(state: SceneState): Action[] {
  return state.landed.map((id) => state.actions[id])
}

// The ids of the actions played out, in the order they landed, not counting
// the reactions to them.
export function getHistory(state: SceneState): string[] {
  return state.landed.filter((id) => state.actions[id].reactionTo === null)
}

// The fight with `live` in play instead of what is, what landed kept: the
// fight a rule weighs when it asks what a declaration would come to.
export function withLiveActions(state: SceneState, live: Action[]): SceneState {
  const actions = { ...state.actions }
  for (const id of state.live) delete actions[id]
  for (const a of live) actions[a.id] = a
  return { ...state, actions, live: live.map((a) => a.id) }
}

// What points at each action, by the link it points with, in the log's order.
// Built once for each table of actions and kept beside it, the way a
// database keeps an index on a foreign key: nothing writes it, so nothing can
// leave it out of step.
type Links = { reactions: Map<string, Action[]>; spawned: Map<string, Action[]>; followUps: Map<string, Action[]> }

const linksOf = new WeakMap<SceneState['actions'], { live: string[]; landed: string[]; links: Links }>()

function getLinks(state: SceneState): Links {
  const kept = linksOf.get(state.actions)
  if (kept && kept.live === state.live && kept.landed === state.landed) return kept.links
  const links: Links = { reactions: new Map(), spawned: new Map(), followUps: new Map() }
  const add = (index: Map<string, Action[]>, id: string | null, a: Action) => {
    if (id === null) return
    const listed = index.get(id)
    if (listed) listed.push(a)
    else index.set(id, [a])
  }
  for (const a of getLog(state)) {
    add(links.reactions, a.reactionTo, a)
    add(links.spawned, a.spawnedBy, a)
    add(links.followUps, a.followUpOf, a)
  }
  linksOf.set(state.actions, { live: state.live, landed: state.landed, links })
  return links
}

// What the action comes of: what it answers, what opened it, or what it is a
// follow-up of.
function getParentId(action: Action): string | null {
  return action.reactionTo ?? action.spawnedBy ?? action.followUpOf
}

// What the action comes of, and so on back, the nearest first.
export function getAncestry(state: SceneState, action: Action): Action[] {
  const ancestors: Action[] = []
  let current = action
  for (;;) {
    const parentId = getParentId(current)
    const parent = parentId ? getAction(state, parentId) : null
    if (!parent || parent.id === action.id || ancestors.some((a) => a.id === parent.id)) return ancestors
    ancestors.push(parent)
    current = parent
  }
}

// What the action came of, by answering or being opened, and so on up: the
// actions it was given rise by. A follow-up comes after what it follows, and
// is not among them.
export function getGivenRiseBy(state: SceneState, action: Action): Action[] {
  const found: Action[] = []
  const queue = [action]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const parentId of [current.reactionTo, current.spawnedBy]) {
      const parent = parentId && parentId !== action.id && !found.some((a) => a.id === parentId) ? getAction(state, parentId) : null
      if (parent) {
        found.push(parent)
        queue.push(parent)
      }
    }
  }
  return found
}

// The action that started the chain this one belongs to. An action of its
// own initiative is its own origin.
export function getOrigin(state: SceneState, action: Action): Action {
  return getAncestry(state, action).at(-1) ?? action
}

export function getReactionsTo(state: SceneState, id: string): Action[] {
  return getLinks(state).reactions.get(id) ?? []
}

// What the action opened: the strike an opportunity attack opens, a prepared
// reaction's move and main action, the fall a move ended in.
export function getSpawned(state: SceneState, id: string): Action[] {
  return getLinks(state).spawned.get(id) ?? []
}

// What the action opened that its actor passed up instead of playing out.
export function getPassedUp(state: SceneState, id: string): Action[] {
  return state.journal.flatMap((e) => (e.reason === 'passedUp' && e.action.spawnedBy === id ? [e.action] : []))
}

// The reactions to the action declared but not yet paid for, and so still
// free to change or take back.
export function getLiveReactionsTo(state: SceneState, id: string): Action[] {
  return getReactionsTo(state, id).filter((r) => r.step !== 'done')
}

// The actor answers nothing of their own — except a blast, which reaches
// them where they stand like anyone else (combat.tex "Explosions").
export function canAnswer(open: Action, characterId: string): boolean {
  return open.actorId !== characterId || open.kind === 'explosion'
}

export function getAction(state: SceneState, id: string): Action | null {
  return Object.hasOwn(state.actions, id) ? state.actions[id] : null
}

// The action a reaction answers; null for one taken on its actor's own
// initiative.
export function getRootOf(state: SceneState, action: Action): RootAction | null {
  const root = action.reactionTo ? getAction(state, action.reactionTo) : null
  return root && isRootAction(root) ? root : null
}

// What the reaction opened, once it has: the strike, maneuver or push an
// opportunity attack opens, a counterattack's strike.
export function getOpenedBy(state: SceneState, reaction: Action): Action | null {
  return getSpawned(state, reaction.id)[0] ?? null
}

// The opportunity attack that opened the action; null for one opened any
// other way.
export function getOpeningReaction(state: SceneState, action: Action): ActionOf<'opportunityAttack'> | null {
  const reaction = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  return reaction?.kind === 'opportunityAttack' ? reaction : null
}

// What an opportunity attack opens: a strike, or against a grapple partner a
// maneuver.
function isOpportunityAction(action: Action | null): action is OpportunityAction {
  return action?.kind === 'strike' || action?.kind === 'grapple'
}

// The action a prepared reaction opened for the preparation itself, once it
// has; its movement, which comes first, is not it.
export function getOpenedMain(state: SceneState, reaction: Action): Action | null {
  return getSpawned(state, reaction.id).find((a) => a.preparedPart === 'main') ?? null
}

// What fights the root along its way: an opportunity attack, or a prepared
// action whose trigger came, each at the step it fires on.
export type DrawnOpportunityAttack = { reaction: ActionOf<'opportunityAttack' | 'prepared'>; spawned: OpportunityAction | null }

// combat.tex "Opportunity Attack": each threatener the action drew gets one
// attack, spawned in turn as the one before lands (commands/sequence.ts
// `openBefore`), each with what it opened if it has. They are
// fought in the order the root comes to them: along the path, for a move or
// a push, whose attacks each fire at a step; in the order they were
// declared, for anything else (combat.tex "Flanking": "resolved in order").
// A prepared action's strike is fought like one, and may stop a move as one
// does (combat.tex "Preparing a reaction").
export function getDrawnOpportunityAttacks(state: SceneState, action: Action): DrawnOpportunityAttack[] {
  return getReactionsTo(state, action.id)
    .flatMap((r) => (r.kind === 'opportunityAttack' || r.kind === 'prepared' ? [r] : []))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    .map((reaction) => {
      const spawned = reaction.kind === 'prepared' ? getOpenedMain(state, reaction) : getOpenedBy(state, reaction)
      return { reaction, spawned: isOpportunityAction(spawned) ? spawned : null }
    })
}

// The table's ruling: follow-ups are a choice, and of those one landed
// action leaves a character — a riposte or a flee, an evasion's move or a
// flee — they take one at most. One still to be declared is forgone once
// another of theirs from the same action has been taken.
export function isForgone(state: SceneState, action: Action): boolean {
  if (action.followUpOf === null || action.step !== 'define') return false
  return (getLinks(state).followUps.get(action.followUpOf) ?? []).some((a) => a.id !== action.id && a.actorId === action.actorId && a.step !== 'define')
}
