import { toThrower, type Throw } from '../../play/calls'
import type { DieSource, RollMode } from '../../play/dice'
import { getActorBar, type Actor, type Viewer } from '../../profiles'
import type { SpellModification } from '../../tables'
import type { ChaseCover, ChaseTier, CrossingSkill } from '../../lists'
import type { SurgeKind, TerrainBrush } from '../../types'
import { getPanelActor, type PanelPress } from '../rules/decider'
import type { CalledKind } from '../rules/heldTest'
import type { ActionDraft, ChaseDeclaration, HOPPurchase, LightLevel, SceneState, Updater } from '../types'
import { answerScene } from './answer'
import { createBoard, importBoard, removeBoard, setLight } from './board'
import { toggleBreakage } from './breakage'
import { crossObstacle, declareChase, endChase, followParty, giveUp, joinFight, mergeBack, putBack, resolveChase, setChaseCover, setPartyFighting, startChase, turnAround } from './chase'
import { readClick, type Click } from './click'
import { endCombat } from './endCombat'
import { dropToFloor, throwOffShieldToFloor } from './floor'
import { rollHeld } from './heldTest'
import { rollMorale, setTablePressure } from './morale'
import { continueRound, holdOn, letGo, nextRound } from './nextRound'
import { createParty, moveToParty, renameParty, splitOff } from './parties'
import { defaultToCoward } from './social'
import { endTurn, rollContest, startTurn, surge, toggleAgreeToEnd, toggleContest } from './turn'
import {
  acceptAnswered, amendAction, amendReaction, boostPush, cancelAction, chooseSpell, commitAction, declareAction, declareReaction,
  passReaction, payAnswered, resolveAction, rollAnswered, rollOrPay, setTarget, stepExtend, withdrawLastReaction, withdrawSpawnedAction,
} from './action'
import { chooseGrapple, chooseManeuver, improveSpell, moveWhileResting, refundHOP, refundImprovement, saveGraze, spendHOP } from './choices'

// The scene's presses and clicks as data: each kind names the command it
// runs and whom it acts for, and takes only plain data as its arguments, so that a press
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
const own = (_: SceneState, id: string): Actor => ({ id })
const anyone = (): Actor => null
const gmTool = (): Actor => 'gmTool'
// a die typed in from the table for a test the press makes, or the table's
// (a die left out comes back null once it has been sent as JSON)
const typed = (ctx: CommandContext, die?: number) => (die === undefined || die === null ? toThrower(ctx.thrower).dice : () => die)
// what the board makes of a click, as the screen that made it saw the board;
// a click that only picks a character there does nothing to the fight
const readOn = (newId: () => string, state: SceneState, click: Click, brush: TerrainBrush | null, reposition: boolean, selected: string | null) => {
  const read = readClick(state, click, { brush, reposition, selected, newId })
  return 'select' in read ? null : read
}

export const sceneCommands = {
  declare: command((ctx, actorId: string, draft: ActionDraft) => declareAction(actorId, draft, ctx.newId)).by((_, actorId) => ({ id: actorId })),
  amend: command((_, fields: Partial<ActionDraft>) => amendAction(fields)).by(panel('open')),
  target: command((_, targetId: string) => setTarget(targetId)).by(panel('open')),
  react: command((ctx, reactorId: string, draft: ActionDraft) => declareReaction(reactorId, draft, ctx.newId)).by(reactor),
  amendReaction: command((_, reactorId: string, fields: Partial<ActionDraft>) => amendReaction(reactorId, fields)).by(reactor),
  pass: command((_, reactorId: string) => passReaction(reactorId)).by(reactor),
  cancel: command(() => cancelAction()).by(panel('open')),
  roll: command((ctx) => rollAnswered(ctx.thrower, ctx.newId)).by(panel('open')),
  // the die thrown, or the price paid, whoever could still answer: the
  // table's press for the bots it plays, never the panel's
  rollOrPay: command((ctx) => rollOrPay(ctx.thrower, ctx.newId)).by(() => 'gm'),
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

  // the board
  click: command((ctx, click: Click, brush: TerrainBrush | null, reposition: boolean, selected: string | null): Updater =>
    (state) => readOn(ctx.newId, state, click, brush, reposition, selected)?.apply(state) ?? state)
    .by((state, click, brush, reposition, selected) => readOn(() => '', state, click, brush, reposition, selected)?.actor ?? null),
  createBoard: command((_, radius: number) => createBoard(radius)).by(gmTool),
  removeBoard: command(() => removeBoard).by(gmTool),
  light: command((_, level: LightLevel) => setLight(level)).by(gmTool),
  // a board from a VTT, read best-effort
  importBoard: command((_, raw: unknown) => importBoard(raw)).by(anyone),

  // what a character lets go of, onto the floor: outside their own turn only
  // the GM lets go for them
  dropToFloor: command((_, id: string, itemId: string, gm: boolean) => dropToFloor(id, itemId, gm)).by((_, id, _item, gm) => (gm ? 'gm' : { id })),
  throwOffShield: command((_, id: string, gm: boolean) => throwOffShieldToFloor(id, gm)).by((_, id, gm) => (gm ? 'gm' : { id })),

  // a die the scene called for, answered by whoever throws it
  answer: command((ctx, callId: string, die: number, source: DieSource) => answerScene(callId, die, source, ctx.thrower, ctx.newId))
    .by((state, callId) => character(state.calls[callId]?.roller ?? null)),

  // the turn and the round
  startTurn: command((_, id: string) => startTurn(id)).by(own),
  toggleContest: command((_, id: string) => toggleContest(id)).by(own),
  toggleAgreeToEnd: command((_, id: string) => toggleAgreeToEnd(id)).by(own),
  surge: command((_, id: string, kind: SurgeKind) => surge(id, kind)).by(own),
  endTurn: command(() => endTurn).by((state) => character(state.inTurnCharacter || null)),
  rollContest: command((ctx) => rollContest(ctx.thrower)).by(anyone),
  nextRound: command((ctx) => nextRound(ctx.thrower)).by(anyone),
  continueRound: command((ctx) => continueRound(ctx.thrower)).by(anyone),
  endCombat: command((ctx) => endCombat(ctx.thrower)).by(anyone),
  holdOn: command((ctx, id: string) => holdOn(id, ctx.thrower)).by(own),
  letGo: command((ctx, id: string) => letGo(id, ctx.thrower)).by(own),
  rollMorale: command((ctx, id: string, mode: RollMode, enemyNear: boolean, die?: number) => rollMorale(id, mode, enemyNear, typed(ctx, die))).by(own),
  rollHeld: command((ctx, id: string, kind: CalledKind, mode: RollMode, die?: number) => rollHeld(id, kind, mode, typed(ctx, die))).by(own),
  setTablePressure: command((_, partyId: string, value: number) => setTablePressure(partyId, value)).by(anyone),
  defaultToCoward: command((_, id: string) => defaultToCoward(id)).by(own),
  toggleBreakage: command(() => toggleBreakage).by(anyone),

  // the fight's parties
  moveToParty: command((_, id: string, partyId: string) => moveToParty(id, partyId)).by(anyone),
  createParty: command((ctx, name: string) => createParty(ctx.newId(), name)).by(anyone),
  splitOff: command((ctx, id: string) => splitOff(id, ctx.newId)).by(anyone),
  renameParty: command((_, partyId: string, name: string) => renameParty(partyId, name)).by(anyone),

  // combat.tex "Chases"
  startChase: command((_, quarry: string[], tier: ChaseTier) => startChase(quarry, tier)).by(anyone),
  declareChase: command((_, partyId: string, declaration: ChaseDeclaration) => declareChase(partyId, declaration)).by(anyone),
  resolveChase: command((ctx) => resolveChase(ctx.thrower)).by(anyone),
  followParty: command((_, partyId: string, target: string) => followParty(partyId, target)).by(anyone),
  putBack: command((_, partyId: string, target: string, tier: ChaseTier) => putBack(partyId, target, tier)).by(anyone),
  giveUp: command((_, partyId: string) => giveUp(partyId)).by(anyone),
  mergeBack: command((_, partyId: string) => mergeBack(partyId)).by(anyone),
  setPartyFighting: command((_, partyId: string, fighting: boolean) => setPartyFighting(partyId, fighting)).by(anyone),
  joinChaseFight: command((_, partyId: string, to: string) => joinFight(partyId, to)).by(anyone),
  crossObstacle: command((ctx, partyId: string, skill: CrossingSkill, DL: number) => crossObstacle(partyId, skill, DL, ctx.thrower)).by(anyone),
  endChase: command(() => endChase).by(anyone),
  turnAround: command((_, id: string) => turnAround(id)).by(anyone),
  setChaseCover: command((_, id: string, cover: ChaseCover | null) => setChaseCover(id, cover)).by(anyone),
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
