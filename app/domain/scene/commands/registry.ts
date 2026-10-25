import { toThrower, type Throw } from '../../play/calls'
import type { DieSource, RollMode } from '../../play/dice'
import type { Actor } from '../../profiles'
import { commandsOver, playedBy, rollerOf, type CommandOf } from '../../registry'
import type { SpellModification } from '../../tables'
import type { ChaseCover, ChaseTier, CrossingSkill } from '../../lists'
import type { CampaignCharacter, Delivery, Item, SurgeKind, TerrainBrush } from '../../types'
import type { ExplosionDraft } from '../rules/impose'
import { getPanelActor, type PanelPress } from '../rules/decider'
import type { CalledKind } from '../rules/heldTest'
import type { ActionDraft, ChaseDeclaration, Coord, HOPPurchase, LightLevel, SceneState, Updater } from '../types'
import { answerScene } from './answer'
import { backSegment, createBoard, loadBoardMap, removeBoard, resizeBoard, setLight } from './board'
import { confirmChase, crossObstacle, declareChase, followParty, giveUp, joinFight, mergeBack, putBack, resolveChase, setChaseCover, setPartyFighting, startChase, turnAround } from './chase'
import { readClick, type Click } from './click'
import { endCombat } from './endCombat'
import { followScene } from './parked'
import { follow } from './follow'
import { dropToFloor, placeItem, removeFloorItem, throwOffShieldToFloor } from './floor'
import { setOffExplosion } from './gmExplosion'
import { impose, updateCharacter, updateInventory } from './characters'
import { toCharacterUpdater, type CharacterCommand, type GearCommand } from '../../character/commands/registry'
import { rollHeld } from './heldTest'
import { rollMorale, setTablePressure } from './morale'
import { continueRound, holdOn, letGo, nextRound } from './nextRound'
import { createParty, deleteParty, moveToParty, renameParty, splitOff } from './parties'
import { defaultToCoward } from './social'
import { agreeAllToEnd, endTurn, rollContest, startTurn, surge, toggleAgreeToEnd, toggleContest } from './turn'
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

const command = commandsOver<SceneState, CommandContext>()

const character = (id: string | null): Actor => (id === null ? null : { id })
const panel = (press: PanelPress) => (state: SceneState): Actor => character(getPanelActor(state, press))
const reactor = (_: SceneState, reactorId: string): Actor => ({ id: reactorId })
const own = (_: SceneState, id: string): Actor => ({ id })
const anyone = (): Actor => null
const gm = (): Actor => 'gm'
// a die typed in from the table for a test the press makes, or the table's
// (a die left out comes back null once it has been sent as JSON)
const typed = (ctx: CommandContext, die?: number) => (die === undefined || die === null ? toThrower(ctx.thrower).dice : () => die)
// what the board makes of a click, as the screen that made it saw the board;
// a click that only picks a character there does nothing to the fight
const readOn = (newId: () => string, state: SceneState, click: Click, brush: TerrainBrush | null, reposition: boolean, selected: string | null) => {
  const read = readClick(state, click, { brush, reposition, selected, newId })
  return 'select' in read ? null : read
}

// a sheet's edit played on a character in the fight, its dice the table's
const sheet = (ctx: CommandContext, edit: CharacterCommand | GearCommand) =>
  toCharacterUpdater(edit, { dice: toThrower(ctx.thrower).dice }) as (c: CampaignCharacter, charged: boolean) => CampaignCharacter

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
  rollOrPay: command((ctx) => rollOrPay(ctx.thrower, ctx.newId)).by(gm),
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
  backSegment: command(() => backSegment()).by(panel('open')),

  // the board
  click: command((ctx, click: Click, brush: TerrainBrush | null, reposition: boolean, selected: string | null): Updater =>
    (state) => readOn(ctx.newId, state, click, brush, reposition, selected)?.apply(state) ?? state)
    .by((state, click, brush, reposition, selected) => readOn(() => '', state, click, brush, reposition, selected)?.actor ?? null),
  createBoard: command((_, radius: number) => createBoard(radius)).by(gm),
  removeBoard: command(() => removeBoard).by(gm),
  resizeBoard: command((_, radius: number) => resizeBoard(radius)).by(gm),
  light: command((_, level: LightLevel) => setLight(level)).by(gm),
  // a kept board, with everyone off it
  loadBoardMap: command((_, raw: unknown) => loadBoardMap(raw)).by(gm),

  // what a character lets go of, onto the floor: outside their own turn only
  // the GM lets go for them
  dropToFloor: command((_, id: string, itemId: string, gm: boolean) => dropToFloor(id, itemId, gm)).by((_, id, _item, gm) => (gm ? 'gm' : { id })),
  placeItem: command((ctx, item: Item, cell: Coord) => placeItem(item, cell, ctx.newId)).by(gm),
  removeFloorItem: command((_, itemId: string) => removeFloorItem(itemId)).by(gm),
  setOffExplosion: command((ctx, draft: ExplosionDraft, cell: Coord) => setOffExplosion(draft, cell, ctx.newId)).by(gm),
  throwOffShield: command((_, id: string, gm: boolean) => throwOffShieldToFloor(id, gm)).by((_, id, gm) => (gm ? 'gm' : { id })),

  // an edit to a character's sheet, and a move with their gear, which the
  // fight refuses outside their own turn unless the GM makes it
  edit: command((ctx, id: string, edit: CharacterCommand, gm: boolean) =>
    updateCharacter(id, sheet(ctx, edit), edit.kind === 'resolvePending' ? 'called test' : gm ? 'GM edit' : undefined)).by((_, id, _edit, gm) => (gm ? 'gm' : { id })),
  editGear: command((ctx, id: string, edit: GearCommand, gm: boolean) =>
    updateInventory(id, sheet(ctx, edit), gm)).by((_, id, _edit, gm) => (gm ? 'gm' : { id })),

  // a test the GM calls for, with the effect that rides on it
  impose: command((_, ids: string[], delivery: Delivery) => impose(ids, delivery)).by(gm),

  // a die the scene called for, answered by whoever throws it
  answer: command((ctx, callId: string, die: number, source: DieSource) => answerScene(callId, die, source, ctx.thrower, ctx.newId))
    .by((state, callId) => rollerOf(state.calls, callId)),

  // the turn and the round
  startTurn: command((_, id: string) => startTurn(id)).by(own),
  toggleContest: command((_, id: string) => toggleContest(id)).by(own),
  toggleAgreeToEnd: command((_, id: string) => toggleAgreeToEnd(id)).by(own),
  agreeAllToEnd: command((_, ids: string[]) => agreeAllToEnd(ids)).by((_, ids) => ({ anyOf: ids })),
  surge: command((_, id: string, kind: SurgeKind) => surge(id, kind)).by(own),
  follow: command((_, id: string, targetId: string | null) => follow(id, targetId)).by(own),
  endTurn: command(() => endTurn).by((state) => character(state.inTurnCharacter || null)),
  rollContest: command((ctx) => rollContest(ctx.thrower)).by(gm),
  nextRound: command((ctx) => nextRound(ctx.thrower)).by(gm),
  continueRound: command((ctx) => continueRound(ctx.thrower)).by(gm),
  endCombat: command((ctx) => endCombat(ctx.thrower)).by(gm),
  followScene: command((ctx, partyId: string) => followScene(partyId, ctx.thrower)).by(gm),
  holdOn: command((ctx, id: string) => holdOn(id, ctx.thrower)).by(own),
  letGo: command((ctx, id: string) => letGo(id, ctx.thrower)).by(own),
  rollMorale: command((ctx, id: string, mode: RollMode, enemyNear: boolean, die?: number) => rollMorale(id, mode, enemyNear, typed(ctx, die))).by(own),
  rollHeld: command((ctx, id: string, kind: CalledKind, mode: RollMode, die?: number) => rollHeld(id, kind, mode, typed(ctx, die))).by(own),
  setTablePressure: command((_, partyId: string, value: number) => setTablePressure(partyId, value)).by(gm),
  defaultToCoward: command((_, id: string) => defaultToCoward(id)).by(own),

  // the fight's parties: a player moves only their own character
  moveToParty: command((_, id: string, partyId: string) => moveToParty(id, partyId)).by(own),
  createParty: command((ctx, name: string) => createParty(ctx.newId(), name)).by(gm),
  splitOff: command((ctx, id: string) => splitOff(id, ctx.newId)).by(own),
  deleteParty: command((_, partyId: string) => deleteParty(partyId)).by(gm),
  renameParty: command((_, partyId: string, name: string) => renameParty(partyId, name)).by(gm),

  // combat.tex "Chases"
  startChase: command((_, quarry: string[], tier: ChaseTier) => startChase(quarry, tier)).by(anyone),
  declareChase: command((_, partyId: string, declaration: ChaseDeclaration) => declareChase(partyId, declaration)).by(anyone),
  confirmChase: command((_, partyId: string) => confirmChase(partyId)).by(anyone),
  resolveChase: command((ctx) => resolveChase(ctx.thrower)).by(anyone),
  followParty: command((_, partyId: string, target: string) => followParty(partyId, target)).by(anyone),
  putBack: command((_, partyId: string, target: string, tier: ChaseTier) => putBack(partyId, target, tier)).by(anyone),
  giveUp: command((_, partyId: string) => giveUp(partyId)).by(anyone),
  mergeBack: command((_, partyId: string) => mergeBack(partyId)).by(anyone),
  setPartyFighting: command((_, partyId: string, fighting: boolean) => setPartyFighting(partyId, fighting)).by(anyone),
  joinChaseFight: command((_, partyId: string, to: string) => joinFight(partyId, to)).by(anyone),
  crossObstacle: command((ctx, partyId: string, skill: CrossingSkill, DL: number) => crossObstacle(partyId, skill, DL, ctx.thrower)).by(anyone),
  turnAround: command((_, id: string) => turnAround(id)).by(anyone),
  setChaseCover: command((_, id: string, cover: ChaseCover | null) => setChaseCover(id, cover)).by(anyone),
}

export type SceneCommand = CommandOf<typeof sceneCommands>
export type SceneCommandKind = SceneCommand['kind']

// Whom a command acts for as of a state (`getCommandActor`), why a viewer may
// not send it (`getCommandBar`), the updater it runs with the table's dice and
// ids (`toUpdater`), and the command played as sent by a viewer, the state
// left as it was when refused (`applySceneCommand`).
export const { actorOf: getCommandActor, barOf: getCommandBar, toUpdater, apply: applySceneCommand } =
  playedBy<SceneState, CommandContext, typeof sceneCommands>(sceneCommands)
