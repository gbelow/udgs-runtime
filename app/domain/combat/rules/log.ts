import type { Action, ActionKind, ActionOf, CombatState } from '../types'

// The fight's log of actions: which one is open, what answers what, and
// what opened what.

// The action being played out: the top of the stack. Nothing can be declared
// while one is open, so there is only ever one root — except for the actions
// a reaction opens (an opportunity attack, a follow, an escape from a blast),
// which are pushed over whatever they were opened against and played out
// first: an opportunity attack on a mover is fought while the move waits to
// resolve, and an explosion a cast opened waits for the escapes its own
// reactions opened.
export function getOpenAction(state: CombatState): Action | null {
  const id = state.stack.at(-1)
  return id ? getAction(state, id) : null
}

// The first root of the kind still being played out — waiting on what it
// opened, or on its own resolve — that `match` accepts.
export function findOpenRoot<K extends ActionKind>(state: CombatState, kind: K, match: (a: ActionOf<K>) => boolean = () => true): ActionOf<K> | null {
  const found = state.actions.find((a): a is ActionOf<K> => a.kind === kind && a.reactionTo === null && a.status !== 'resolved' && match(a as ActionOf<K>))
  return found ?? null
}

export function getReactionsTo(state: CombatState, id: string): Action[] {
  return state.actions.filter((a) => a.reactionTo === id)
}

// The reactions to the action declared but not yet paid for, and so still
// free to change or take back.
export function getLiveReactionsTo(state: CombatState, id: string): Action[] {
  return getReactionsTo(state, id).filter((r) => r.status !== 'resolved')
}

// The actor answers nothing of their own — except a blast, which reaches
// them where they stand like anyone else (combat.tex "Explosions").
export function canAnswer(open: Action, characterId: string): boolean {
  return open.actorId !== characterId || open.kind === 'explosion'
}

export function getAction(state: CombatState, id: string): Action | null {
  return state.actions.find((a) => a.id === id) ?? null
}

// The action a reaction answers; null for one taken on its actor's own
// initiative.
export function getRootOf(state: CombatState, action: Action): Action | null {
  return action.reactionTo ? getAction(state, action.reactionTo) : null
}

// The opportunity attack that opened the action; null for one opened any
// other way.
export function getOpeningReaction(state: CombatState, action: Action): ActionOf<'opportunityAttack'> | null {
  const reaction = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  return reaction?.kind === 'opportunityAttack' ? reaction : null
}
