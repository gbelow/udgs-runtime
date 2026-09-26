import type { Action, ActionKind, ActionOf, CombatState, RootAction } from '../types'
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
export function getOpenAction(state: CombatState): RootAction | null {
  const id = state.stack.at(-1)
  const open = id ? getAction(state, id) : null
  return open && isRootAction(open) ? open : null
}

// The first root of the kind still being played out — waiting on what it
// opened, or on its own resolve — that `match` accepts, from the bottom of
// the stack up.
export function findOpenRoot<K extends ActionKind>(state: CombatState, kind: K, match: (a: ActionOf<K>) => boolean = () => true): ActionOf<K> | null {
  for (const id of state.stack) {
    const action = getAction(state, id)
    if (action?.kind === kind && match(action as ActionOf<K>)) return action as ActionOf<K>
  }
  return null
}

export function getReactionsTo(state: CombatState, id: string): Action[] {
  return state.actions.filter((a) => a.reactionTo === id)
}

// The reactions to the action declared but not yet paid for, and so still
// free to change or take back.
export function getLiveReactionsTo(state: CombatState, id: string): Action[] {
  return getReactionsTo(state, id).filter((r) => r.step !== 'done')
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
export function getRootOf(state: CombatState, action: Action): RootAction | null {
  const root = action.reactionTo ? getAction(state, action.reactionTo) : null
  return root && isRootAction(root) ? root : null
}

// What the reaction opened, once it has: the strike, maneuver or push an
// opportunity attack opens, a counterattack's strike.
export function getOpenedBy(state: CombatState, reaction: Action): Action | null {
  return state.actions.find((a) => a.spawnedBy === reaction.id) ?? null
}

// The opportunity attack that opened the action; null for one opened any
// other way.
export function getOpeningReaction(state: CombatState, action: Action): ActionOf<'opportunityAttack'> | null {
  const reaction = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  return reaction?.kind === 'opportunityAttack' ? reaction : null
}
