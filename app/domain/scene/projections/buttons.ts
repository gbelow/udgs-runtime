import { getDiceBar } from '../../play/calls'
import { getContestWait, isContestPending } from '../rules/contest'
import { getRestAwaited } from '../rules/resting'
import type { SceneState } from '../types'
import type { SceneCommand } from '../commands/registry'
import { perState } from '../../perState'
import { getOpenAction, getLiveReactionsTo, canAnswer } from '../rules/log'
import { getGoBar, getOpenOptions } from '../rules/options'
import { getHoldCost, getNextStep, getPayableCost, isPreparedRequired, needsDie } from '../rules/action'
import { canAcceptSpellTest } from '../rules/cast'
import { getContestBar, getEndTurnBar, getNextRoundBar, getRollContestBar, getStartTurnBar, hasAgreedToEnd } from '../rules/turn'
import { getEndCombatBar } from '../rules/fight'
import { isCombatStarted } from '../rules/started'
import { getConcentrationOwed, getContinueBar, getHoldOnBar, getLetGoBar, getRoundPhase } from '../rules/roundChange'
import { getEnemyNear, getFatefulBar, getHypeUpBar, getKeepMoraleBar, getMoraleBar, getMoraleModes, getSkipMoraleBar } from '../rules/morale'
import { getOrderOptions, getOverrulable } from '../rules/domination'
import { getFightName } from '../rules/fighters'
import { getBindingSurge } from '../../character/rules/surge'
import { getCombatSurgeOptions } from './turn'
import { getOptionLabel } from './labels'
import { getHeldRows } from './heldTests'
import { getCowardBar } from './morale'
import { getMockeryView } from './domination'
import { getLeadershipView } from './providence'

// Every button that moves the fight on and is open now, whoever it acts for
// (the registry's `getCommandActor` says that): taking and ending turns,
// surges, declaring and answering actions, and taking an open action through
// its steps, the round change, and the GM's next round and end. Each is the
// command its button sends, gated by the same rules the screen shows it
// closed by. What fills a declaration in (a row, a target, a path, what the
// overflow buys) is not here: those are the open action's own choices. The
// round's tests and the limit stress actions are.
//
// They come in two parts: the buttons that act for one character, read for
// that character alone (`getButtonsOf`), so a seat at the table reads only its
// own; and the ones that move the open action, the turn or the round on for
// whoever it is up to (`getSharedButtons`).
//
// A morale test is offered as the board measures an enemy near
// (`getEnemyNear`), and where it cannot tell, as the table's checkbox leaves
// it by default, with one.

export type OpenButton = { command: SceneCommand; label: string }

export const getOpenButtons = perState((state: SceneState): OpenButton[] => [
  ...ids(state).flatMap((id) => getButtonsOf(state, id)),
  ...getSharedButtons(state),
])

const byId = new WeakMap<SceneState, Map<string, OpenButton[]>>()

export function getButtonsOf(state: SceneState, id: string): OpenButton[] {
  const known = byId.get(state) ?? new Map<string, OpenButton[]>()
  byId.set(state, known)
  const made = known.get(id)
  if (made) return made
  const buttons = state.characters[id] ? [
    ...turnButtonsOf(state, id),
    ...actionButtonsOf(state, id),
    ...roundChangeButtonsOf(state, id),
    ...stressButtonsOf(state, id),
  ] : []
  known.set(id, buttons)
  return buttons
}

export const getSharedButtons = perState((state: SceneState): OpenButton[] => [
  ...button(getEndTurnBar(state) === null, { kind: 'endTurn', args: [] }, 'end the turn'),
  ...button(getRollContestBar(state) === null, { kind: 'rollContest', args: [] }, 'roll the contest for the turn'),
  ...button(isContestPending(state) && getDiceBar(state.calls) === null, { kind: 'closeContest', args: [] }, 'the time to contest the turn is over'),
  ...openActionButtons(state),
  ...button(!!getRoundPhase(state) && getContinueBar(state) === null, { kind: 'continueRound', args: [] }, 'on with the round change'),
  ...button(getNextRoundBar(state) === null, { kind: 'nextRound', args: [] }, 'next round'),
  ...button(getEndCombatBar(state) === null, { kind: 'endCombat', args: [] }, 'end the combat'),
])

const button = (open: boolean, command: SceneCommand, label: string): OpenButton[] => (open ? [{ command, label }] : [])

const ids = (state: SceneState) => Object.keys(state.characters)

function turnButtonsOf(state: SceneState, id: string): OpenButton[] {
  const name = getFightName(state, id)
  return [
    ...button(getStartTurnBar(state, id) === null, { kind: 'startTurn', args: [id] }, `${name}: start a turn`),
    ...button(getContestBar(state, id) === null, { kind: 'toggleContest', args: [id] }, `${name}: ${state.contenders.includes(id) ? 'stop contesting' : 'contest'} the turn`),
    ...button(isCombatStarted(state), { kind: 'toggleAgreeToEnd', args: [id] }, `${name}: ${hasAgreedToEnd(state, id) ? 'take back agreeing' : 'agree'} to end the round`),
    ...getCombatSurgeOptions(state, id).flatMap((o) => button(o.available, { kind: 'surge', args: [id, o.kind] }, `${name}: ${o.kind} surge`)),
    ...(() => {
      const c = state.characters[id]
      const binding = c ? getBindingSurge(c) : null
      return button(binding !== null, { kind: 'edit', args: [id, { kind: 'endSurge', args: [] }, false] }, `${name}: give up the ${binding} surge AP left`)
    })(),
    ...button(getMockeryView(state, id)?.bar === null, { kind: 'mock', args: [id] }, `${name}: mock`),
  ]
}

// Declaring with nothing open; answering the open action at its react step.
function actionButtonsOf(state: SceneState, id: string): OpenButton[] {
  const open = getOpenAction(state)
  const options = () => getOpenOptions(state, id)
  const name = getFightName(state, id)
  if (!open) return options().map((o): OpenButton => ({ command: { kind: 'declare', args: [id, o.draft] }, label: `${name}: ${getOptionLabel(state, id, o)}` }))
  if (getNextStep(state) !== 'react') return []
  return [
    ...options().map((o): OpenButton => ({ command: { kind: 'react', args: [id, o.draft, o.surge] }, label: `${name}: ${getOptionLabel(state, id, o)}` })),
    ...button(canAnswer(open, id) && (!open.passed.includes(id) || getLiveReactionsTo(state, open.id).some((r) => r.actorId === id)), { kind: 'pass', args: [id] }, `${name}: pass`),
  ]
}

function openActionButtons(state: SceneState): OpenButton[] {
  const open = getOpenAction(state)
  if (!open) return []
  const step = getNextStep(state)
  const reacting = step === 'react'
  const go = reacting && getGoBar(state, open) === null
  const die = needsDie(state, open)
  return [
    ...button(reacting && getLiveReactionsTo(state, open.id).length > 0, { kind: 'back', args: [] }, 'take the last answer back'),
    ...button(go && die, { kind: 'roll', args: [] }, 'roll'),
    ...button(go && !die, { kind: 'pay', args: [] }, 'pay'),
    ...button(reacting && open.kind === 'spellTest' && canAcceptSpellTest(open), { kind: 'accept', args: [] }, 'accept the spell'),
    ...button(step === 'commit' && getContestWait(state) === null && (getPayableCost(state, open) !== null || getHoldCost(state, open) !== null), { kind: 'commit', args: [] }, 'commit'),
    ...button(open.step === 'define' && !open.spawnedBy, { kind: 'cancel', args: [] }, 'cancel'),
    ...button(open.step === 'define' && !!open.spawnedBy && !isPreparedRequired(state, open), { kind: 'skip', args: [] }, 'pass it up'),
    ...button(open.step === 'post' && (step === 'confirm' || step === 'spend'), { kind: 'resolve', args: [] }, 'land it'),
  ]
}

// The round change: holding on or letting go, the morale test and what may
// be chosen of it, and the rally once the tests are made.
function roundChangeButtonsOf(state: SceneState, id: string): OpenButton[] {
  if (!getRoundPhase(state)) return []
  const name = getFightName(state, id)
  const concentration = getConcentrationOwed(state).includes(id) ? [
    ...button(getHoldOnBar(state, id) === null, { kind: 'holdOn', args: [id] }, `${name}: hold on`),
    ...button(getLetGoBar(state, id) === null, { kind: 'letGo', args: [id] }, `${name}: let go`),
  ] : []
  const morale = state.morale.some((m) => m.id === id) ? [
    ...getMoraleModes(state.characters[id]).flatMap((mode) => button(getMoraleBar(state, id) === null, { kind: 'rollMorale', args: [id, mode, getEnemyNear(state, id) ?? true] }, `${name}: morale ${mode}`)),
    ...button(getSkipMoraleBar(state, id) === null, { kind: 'skipMorale', args: [id] }, `${name}: skip the morale test`),
    ...button(getKeepMoraleBar(state, id) === null, { kind: 'keepMorale', args: [id] }, `${name}: keep the morale roll`),
    ...button(getFatefulBar(state, id) === null, { kind: 'rerollMorale', args: [id] }, `${name}: reroll morale`),
    ...button(getHypeUpBar(state, id) === null, { kind: 'hypeUp', args: [id] }, `${name}: hype up`),
  ] : []
  return [
    ...concentration,
    ...morale,
    ...button(getRestAwaited(state).includes(id), { kind: 'doneResting', args: [[id]] }, `${name}: done resting`),
    ...button(getLeadershipView(state, id)?.bar === null, { kind: 'leadershipRally', args: [id] }, `${name}: rally`),
  ]
}

// What the round's tests and its limit stress actions ask of the character:
// a test the round called them to (swimming), being taken for a coward, and
// the orders they could give whoever owes a limit stress action.
function stressButtonsOf(state: SceneState, id: string): OpenButton[] {
  const name = getFightName(state, id)
  const held = getHeldRows(state).filter((r) => r.id === id && r.bar === null).flatMap((r) =>
    r.modes.map((mode): OpenButton => ({ command: { kind: 'rollHeld', args: [id, r.kind, mode] }, label: `${name}: ${r.kind} ${mode}` })))
  const orders = ids(state).filter((target) => target !== id && getOverrulable(state, target)).flatMap((target) =>
    getOrderOptions(state, id, target).flatMap((o) => button(o.bar === null, { kind: 'giveOrder', args: [id, target, o.order] }, `${name}: order ${getFightName(state, target)} to ${o.order}`)))
  return [
    ...held,
    ...button(getCowardBar(state, id) === null, { kind: 'defaultToCoward', args: [id] }, `${name}: take for a coward`),
    ...orders,
  ]
}
