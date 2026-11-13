import type { SceneState } from '../types'
import type { SceneCommand } from '../commands/registry'
import { perState } from '../../perState'
import { getOpenAction, getLiveReactionsTo, canAnswer } from '../rules/log'
import { getAvailableActions, getGoBar } from '../rules/options'
import { getHoldCost, getNextStep, getPayableCost, isPreparedRequired, needsDie } from '../rules/action'
import { canAcceptSpellTest } from '../rules/cast'
import { getContestBar, getEndTurnBar, getNextRoundBar, getRollContestBar, getStartTurnBar, hasAgreedToEnd } from '../rules/turn'
import { getEndCombatBar } from '../rules/fight'
import { isCombatStarted } from '../rules/started'
import { getConcentrationOwed, getContinueBar, getHoldOnBar, getLetGoBar, getRoundPhase } from '../rules/roundChange'
import { getFatefulBar, getHypeUpBar, getKeepMoraleBar, getMoraleBar, getMoraleModes, getSkipMoraleBar } from '../rules/morale'
import { getFightName } from '../rules/fighters'
import { getCombatSurgeOptions } from './turn'
import { getOptionLabel } from './labels'

// Every button that moves the fight on and is open now, whoever it acts for
// (the registry's `getCommandActor` says that): taking and ending turns,
// surges, declaring and answering actions, and taking an open action through
// its steps, the round change, and the GM's next round and end. Each is the
// command its button sends, gated by the same rules the screen shows it
// closed by. What fills a declaration in (a row, a target, a path, what the
// overflow buys) is not here: those are the open action's own choices.
//
// A morale test is offered as the table's checkbox leaves it by default, with
// an enemy near.

export type OpenButton = { command: SceneCommand; label: string }

export const getOpenButtons = perState((state: SceneState): OpenButton[] => [
  ...turnButtons(state),
  ...actionButtons(state),
  ...roundChangeButtons(state),
  ...tableButtons(state),
])

const button = (open: boolean, command: SceneCommand, label: string): OpenButton[] => (open ? [{ command, label }] : [])

const ids = (state: SceneState) => Object.keys(state.characters)

function turnButtons(state: SceneState): OpenButton[] {
  const started = isCombatStarted(state)
  const each = ids(state).flatMap((id): OpenButton[] => {
    const name = getFightName(state, id)
    return [
      ...button(getStartTurnBar(state, id) === null, { kind: 'startTurn', args: [id] }, `${name}: start a turn`),
      ...button(getContestBar(state, id) === null, { kind: 'toggleContest', args: [id] }, `${name}: ${state.contenders.includes(id) ? 'stop contesting' : 'contest'} the turn`),
      ...button(started, { kind: 'toggleAgreeToEnd', args: [id] }, `${name}: ${hasAgreedToEnd(state, id) ? 'take back agreeing' : 'agree'} to end the round`),
      ...getCombatSurgeOptions(state, id).flatMap((o) => button(o.available, { kind: 'surge', args: [id, o.kind] }, `${name}: ${o.kind} surge`)),
    ]
  })
  return [
    ...each,
    ...button(getEndTurnBar(state) === null, { kind: 'endTurn', args: [] }, 'end the turn'),
    ...button(getRollContestBar(state) === null, { kind: 'rollContest', args: [] }, 'roll the contest for the turn'),
  ]
}

function actionButtons(state: SceneState): OpenButton[] {
  const open = getOpenAction(state)
  const options = (id: string) => getAvailableActions(state, id).filter((o) => o.available)
  if (!open) {
    return ids(state).flatMap((id) => options(id).flatMap((o) => button(true, { kind: 'declare', args: [id, o.draft] }, `${getFightName(state, id)}: ${getOptionLabel(state, id, o)}`)))
  }
  const step = getNextStep(state)
  const reacting = step === 'react'
  const answers = reacting
    ? ids(state).flatMap((id): OpenButton[] => [
        ...options(id).flatMap((o) => button(true, { kind: 'react', args: [id, o.draft] }, `${getFightName(state, id)}: ${getOptionLabel(state, id, o)}`)),
        ...button(canAnswer(open, id) && (!open.passed.includes(id) || getLiveReactionsTo(state, open.id).some((r) => r.actorId === id)), { kind: 'pass', args: [id] }, `${getFightName(state, id)}: pass`),
      ])
    : []
  const go = reacting && getGoBar(state, open) === null
  const die = needsDie(state, open)
  return [
    ...answers,
    ...button(reacting && getLiveReactionsTo(state, open.id).length > 0, { kind: 'back', args: [] }, 'take the last answer back'),
    ...button(go && die, { kind: 'roll', args: [] }, 'roll'),
    ...button(go && !die, { kind: 'pay', args: [] }, 'pay'),
    ...button(reacting && open.kind === 'spellTest' && canAcceptSpellTest(open), { kind: 'accept', args: [] }, 'accept the spell'),
    ...button(step === 'commit' && (getPayableCost(state, open) !== null || getHoldCost(state, open) !== null), { kind: 'commit', args: [] }, 'commit'),
    ...button(open.step === 'define' && !open.spawnedBy, { kind: 'cancel', args: [] }, 'cancel'),
    ...button(open.step === 'define' && !!open.spawnedBy && !isPreparedRequired(state, open), { kind: 'skip', args: [] }, 'pass it up'),
    ...button(open.step === 'post' && (step === 'confirm' || step === 'spend'), { kind: 'resolve', args: [] }, 'land it'),
  ]
}

function roundChangeButtons(state: SceneState): OpenButton[] {
  if (!getRoundPhase(state)) return []
  const concentration = getConcentrationOwed(state).flatMap((id): OpenButton[] => [
    ...button(getHoldOnBar(state, id) === null, { kind: 'holdOn', args: [id] }, `${getFightName(state, id)}: hold on`),
    ...button(getLetGoBar(state, id) === null, { kind: 'letGo', args: [id] }, `${getFightName(state, id)}: let go`),
  ])
  const morale = state.morale.filter((m) => state.characters[m.id]).flatMap(({ id }): OpenButton[] => {
    const name = getFightName(state, id)
    const rollable = getMoraleBar(state, id) === null
    return [
      ...getMoraleModes(state.characters[id]).flatMap((mode) => button(rollable, { kind: 'rollMorale', args: [id, mode, true] }, `${name}: morale ${mode}`)),
      ...button(getSkipMoraleBar(state, id) === null, { kind: 'skipMorale', args: [id] }, `${name}: skip the morale test`),
      ...button(getKeepMoraleBar(state, id) === null, { kind: 'keepMorale', args: [id] }, `${name}: keep the morale roll`),
      ...button(getFatefulBar(state, id) === null, { kind: 'rerollMorale', args: [id] }, `${name}: reroll morale`),
      ...button(getHypeUpBar(state, id) === null, { kind: 'hypeUp', args: [id] }, `${name}: hype up`),
    ]
  })
  return [
    ...concentration,
    ...morale,
    ...button(getContinueBar(state) === null, { kind: 'continueRound', args: [] }, 'on with the round change'),
  ]
}

function tableButtons(state: SceneState): OpenButton[] {
  return [
    ...button(getNextRoundBar(state) === null, { kind: 'nextRound', args: [] }, 'next round'),
    ...button(getEndCombatBar(state) === null, { kind: 'endCombat', args: [] }, 'end the combat'),
  ]
}
