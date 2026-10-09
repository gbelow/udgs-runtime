import type { Action, ActionKind, ActionOf, SceneState, OpportunityAction, RootAction } from '../types'
import { isRootAction } from './actionCatalog'

// The fight's log of actions: which one is open, what answers what, and
// what opened what.

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
  return [...state.record, ...state.actions]
}

// The ids of the actions played out, in the order they landed, not counting
// the reactions to them.
export function getHistory(state: SceneState): string[] {
  return state.record.filter((a) => a.reactionTo === null).map((a) => a.id)
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

// Everything that comes of the action, the way `getAncestry` walks back: its
// reactions, what it opened, its follow-ups, and so on down.
export function getDescendants(state: SceneState, id: string): Action[] {
  const children = new Map<string, Action[]>()
  for (const a of getLog(state)) {
    const parentId = getParentId(a)
    if (parentId) children.set(parentId, [...(children.get(parentId) ?? []), a])
  }
  const found: Action[] = []
  const seen = new Set([id])
  const queue = [id]
  while (queue.length > 0) {
    for (const a of children.get(queue.shift()!) ?? []) {
      if (seen.has(a.id)) continue
      seen.add(a.id)
      found.push(a)
      queue.push(a.id)
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
  return getLog(state).filter((a) => a.reactionTo === id)
}

// What the action opened: the strike an opportunity attack opens, a prepared
// reaction's move and main action, the fall a move ended in.
export function getSpawned(state: SceneState, id: string): Action[] {
  return getLog(state).filter((a) => a.spawnedBy === id)
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
  return state.actions.find((a) => a.id === id) ?? state.record.find((a) => a.id === id) ?? null
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
  return getLog(state).some((a) => a.id !== action.id && a.followUpOf === action.followUpOf && a.actorId === action.actorId && a.step !== 'define')
}
