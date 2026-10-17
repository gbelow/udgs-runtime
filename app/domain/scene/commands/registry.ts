import type { Throw } from '../../play/calls'
import { getActorBar, type Actor, type Viewer } from '../../profiles'
import type { SpellModification } from '../../tables'
import { getPanelActor, type PanelPress } from '../rules/decider'
import type { ActionDraft, HOPPurchase, SceneState, Updater } from '../types'
import {
  acceptAnswered, amendAction, amendReaction, boostPush, cancelAction, chooseSpell, commitAction, declareAction, declareReaction,
  passReaction, payAnswered, resolveAction, rollAnswered, setTarget, stepExtend, withdrawLastReaction, withdrawSpawnedAction,
} from './action'
import { chooseGrapple, chooseManeuver, improveSpell, moveWhileResting, refundHOP, refundImprovement, saveGraze, spendHOP } from './choices'

// The scene's presses as data: each kind names the command it runs and whom
// it acts for, and takes only plain data as its arguments, so that a press
// can be sent from one screen and played on another. What the table that
// plays it supplies, the dice and the ids, comes in the context.

export type CommandContext = { thrower: Throw; newId: () => string }

type Entry<A extends unknown[]> = {
  run: (ctx: CommandContext, ...args: A) => Updater
  actor: (state: SceneState, ...args: A) => Actor
}

const command = <A extends unknown[]>(run: Entry<A>['run']) => ({
  by: (actor: Entry<A>['actor']): Entry<A> => ({ run, actor }),
})

const character = (id: string | null): Actor => (id === null ? null : { id })
const panel = (press: PanelPress) => (state: SceneState): Actor => character(getPanelActor(state, press))
const reactor = (_: SceneState, reactorId: string): Actor => ({ id: reactorId })

export const sceneCommands = {
  declare: command((ctx, actorId: string, draft: ActionDraft) => declareAction(actorId, draft, ctx.newId)).by((_, actorId) => ({ id: actorId })),
  amend: command((_, fields: Partial<ActionDraft>) => amendAction(fields)).by(panel('open')),
  target: command((_, targetId: string) => setTarget(targetId)).by(panel('open')),
  react: command((ctx, reactorId: string, draft: ActionDraft) => declareReaction(reactorId, draft, ctx.newId)).by(reactor),
  amendReaction: command((_, reactorId: string, fields: Partial<ActionDraft>) => amendReaction(reactorId, fields)).by(reactor),
  pass: command((_, reactorId: string) => passReaction(reactorId)).by(reactor),
  cancel: command(() => cancelAction()).by(panel('open')),
  roll: command((ctx) => rollAnswered(ctx.thrower, ctx.newId)).by(panel('open')),
  commit: command((ctx) => commitAction(ctx.thrower, ctx.newId)).by(panel('open')),
  back: command(() => withdrawLastReaction()).by(panel('back')),
  skip: command((ctx) => withdrawSpawnedAction(ctx.thrower, ctx.newId)).by(panel('open')),
  pay: command((ctx) => payAnswered(ctx.newId, ctx.thrower)).by(panel('open')),
  accept: command((ctx) => acceptAnswered(ctx.newId, ctx.thrower)).by(panel('accept')),
  spend: command((_, purchase: HOPPurchase) => spendHOP(purchase)).by(panel('open')),
  refund: command((_, purchase: HOPPurchase) => refundHOP(purchase)).by(panel('open')),
  grapple: command((_, on: boolean) => chooseGrapple(on)).by(panel('open')),
  resolve: command((ctx) => resolveAction(ctx.newId, ctx.thrower)).by(panel('open')),
  improve: command((_, name: SpellModification) => improveSpell(name)).by(panel('open')),
  unimprove: command((_, name: SpellModification) => refundImprovement(name)).by(panel('open')),
  grazeSave: command(() => saveGraze()).by(panel('open')),
  restMove: command((ctx) => moveWhileResting(ctx.newId)).by(panel('open')),
  extend: command((_, delta: 1 | -1) => stepExtend(delta)).by(panel('open')),
  cast: command((_, key: string, quicken: boolean) => chooseSpell(key, quicken)).by(panel('open')),
  choose: command((_, fields: { along?: boolean; item?: string }) => chooseManeuver(fields)).by(panel('open')),
  boostPush: command((_, boost: boolean) => boostPush(boost)).by(panel('open')),
}

type Registry = typeof sceneCommands
export type SceneCommandKind = keyof Registry
export type SceneCommand = { [K in SceneCommandKind]: { kind: K; args: Registry[K] extends Entry<infer A> ? A : never } }[SceneCommandKind]

const entryOf = (command: SceneCommand): Entry<unknown[]> => sceneCommands[command.kind] as Entry<unknown[]>

// Whom the command acts for, as of `state`.
export function getCommandActor(state: SceneState, command: SceneCommand): Actor {
  return entryOf(command).actor(state, ...command.args)
}

// Why `viewer` may not send the command, or null when they may.
export function getCommandBar(state: SceneState, command: SceneCommand, viewer: Viewer): string | null {
  return getActorBar(getCommandActor(state, command), viewer)
}

// The command as the updater it runs, with the table's dice and ids.
export function toUpdater(command: SceneCommand, ctx: CommandContext): Updater {
  return entryOf(command).run(ctx, ...command.args)
}

// The command played as sent by `viewer`: refused, the state stays as it was.
export function applySceneCommand(state: SceneState, command: SceneCommand, viewer: Viewer, ctx: CommandContext): SceneState {
  return getCommandBar(state, command, viewer) === null ? toUpdater(command, ctx)(state) : state
}
