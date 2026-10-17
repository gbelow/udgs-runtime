import { getActorBar, type Actor, type Viewer } from './profiles'
import type { Calls } from './play/calls'

// A part of play's presses as data: each kind names the command it runs over
// the part's state and whom it acts for, and takes only plain data as its
// arguments, so that a press can be sent from one screen and played on
// another. What the table that plays it supplies, its dice and its ids, comes
// in the context.

export type Entry<S, X, A extends unknown[]> = {
  run: (ctx: X, ...args: A) => (state: S) => S
  actor: (state: S, ...args: A) => Actor
}

// The entry maker for a registry over state `S` with context `X`.
export const commandsOver = <S, X>() => <A extends unknown[]>(run: Entry<S, X, A>['run']) => ({
  by: (actor: Entry<S, X, A>['actor']): Entry<S, X, A> => ({ run, actor }),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any entry's state and context, to read its arguments off
type AnyEntry = Entry<any, any, any>

export type CommandOf<R> = {
  [K in keyof R & string]: { kind: K; args: R[K] extends AnyEntry ? Parameters<R[K]['actor']> extends [unknown, ...infer A] ? A : never : never }
}[keyof R & string]

// Whoever throws the die a call waits on, for the command that answers it.
export const rollerOf = (calls: Calls, callId: string): Actor => {
  const roller = calls[callId]?.roller
  return roller ? { id: roller } : null
}

// What a registry's commands are played with: whom one acts for as of a
// state, why a viewer may not send it, the updater it runs, and the command
// played as sent by a viewer, which leaves the state as it was when refused.
export function playedBy<S, X, R extends Record<string, Entry<S, X, never>>>(registry: R) {
  const entryOf = (command: CommandOf<R>) => registry[command.kind] as unknown as Entry<S, X, unknown[]>
  const actorOf = (state: S, command: CommandOf<R>): Actor => entryOf(command).actor(state, ...command.args)
  const barOf = (state: S, command: CommandOf<R>, viewer: Viewer): string | null => getActorBar(actorOf(state, command), viewer)
  const toUpdater = (command: CommandOf<R>, ctx: X): ((state: S) => S) => entryOf(command).run(ctx, ...command.args)
  const apply = (state: S, command: CommandOf<R>, viewer: Viewer, ctx: X): S =>
    barOf(state, command, viewer) === null ? toUpdater(command, ctx)(state) : state
  return { actorOf, barOf, toUpdater, apply }
}

// An edit to one thing a state holds (a character, a map), as data: each kind
// names the change it makes and takes only plain data, and whom it acts for
// is the command that carries it into the state.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any edit's context, to read its arguments off
export type EditOf<R> = { [K in keyof R & string]: { kind: K; args: R[K] extends (ctx: any, ...args: infer A) => unknown ? A : never } }[keyof R & string]

// The entry maker for edits with context `X` making changes `U`.
export const editsOver = <X, U>() => <A extends unknown[]>(run: (ctx: X, ...args: A) => U) => run

export function toEdit<X, U>(registry: Record<string, (ctx: X, ...args: never) => U>, command: { kind: string; args: unknown[] }, ctx: X): U {
  return (registry[command.kind] as (ctx: X, ...args: unknown[]) => U)(ctx, ...command.args)
}
