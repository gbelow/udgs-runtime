import type { Action, RootAction, SceneState } from '../types'
import type { SceneCommand } from '../commands/registry'
import type { MenuPress } from '../commands/clickMenu'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getOpenAction, getReactionsTo } from '../rules/log'
import { getContestWait } from '../rules/contest'
import { areReactionsComplete, getHoldCost, getNextStep, getOwnCost, getPayableCost, needsDie } from '../rules/action'
import { getGoBar } from '../rules/options'
import { getHeldBackAnswerers, getHeldBackBar } from '../rules/reactions'
import { getFightName } from '../rules/fighters'
import { getActionOffers, getOpenLabel, type ReactorOptions } from './actionPanel'
import { getOpenButtons } from './buttons'
import { getOpenChoices, type ChoicePart, type OpenChoice } from './choices'

// The action the board's popover declared, walked where the popover was: its
// declaration one step at a time, each the fills of one part of it
// (`getOpenChoices`), then the commit; then the exchange, each answerer's
// answer a step at a time (what it is, the surge it is made on, what it is
// declared as, their word that they are done), and the actor's go. An action
// an answer opens on top of it is walked the same way while it is open. A
// step offers nothing to choose when it has no other value to give, and is
// not shown.
//
// Which steps are behind is the screen's to keep (`WalkState`): the walk is
// told the parts the pressed entry already gave (`getGivenSteps`) and, for
// each action and each answerer to it, the steps walked through since.
//
// A `pick` step takes one value and is done; a `toggles` step switches any of
// its toggles and a `steps` step moves a number a step at a time, and both
// are left by going on.

export type WalkKey = ChoicePart | 'answer' | 'surge'

// `actionId`, the action walked, once it is seen open; `given`, the steps of
// its declaration the entry gave; `passed`, keyed by `walkKey`.
export type WalkState = { actorId: string; actionId: string | null; given: readonly WalkKey[]; passed: Readonly<Record<string, readonly WalkKey[]>> }

// Whose steps a list of passed steps is: an action's declaration, or one answerer's answer to it.
export const walkKey = (actionId: string, reactorId: string | null = null) => (reactorId ? `${actionId}:${reactorId}` : actionId)

type StepKind = 'pick' | 'toggles' | 'steps'
type StepDef = { key: ChoicePart; label: string; parts: readonly ChoicePart[]; kind: StepKind }

const STEPS: readonly StepDef[] = [
  { key: 'opportunityMode', label: 'made as', parts: ['opportunityMode'], kind: 'pick' },
  { key: 'maneuver', label: 'maneuver', parts: ['maneuver'], kind: 'pick' },
  { key: 'for', label: 'prepare for', parts: ['for'], kind: 'pick' },
  { key: 'main', label: 'prepare', parts: ['main'], kind: 'pick' },
  { key: 'flee', label: 'flee or end', parts: ['flee'], kind: 'pick' },
  { key: 'row', label: 'attack', parts: ['row'], kind: 'pick' },
  { key: 'defense', label: 'defense', parts: ['defense'], kind: 'pick' },
  { key: 'spell', label: 'spell', parts: ['spell'], kind: 'pick' },
  { key: 'movement', label: 'movement', parts: ['movement'], kind: 'pick' },
  { key: 'target', label: 'target', parts: ['target'], kind: 'pick' },
  { key: 'trigger', label: 'when', parts: ['trigger'], kind: 'pick' },
  { key: 'location', label: 'aim', parts: ['location', 'object'], kind: 'pick' },
  { key: 'ammo', label: 'ammo', parts: ['ammo'], kind: 'pick' },
  { key: 'item', label: 'item', parts: ['item'], kind: 'pick' },
  { key: 'container', label: 'open', parts: ['container'], kind: 'pick' },
  { key: 'charge', label: 'charge', parts: ['charge'], kind: 'pick' },
  { key: 'gear', label: 'with', parts: ['gear'], kind: 'pick' },
  { key: 'chargeInto', label: 'charge into', parts: ['chargeInto'], kind: 'pick' },
  { key: 'suggested', label: 'suggest', parts: ['suggested'], kind: 'pick' },
  { key: 'sweep', label: 'sweep', parts: ['sweep'], kind: 'pick' },
  { key: 'firedAt', label: 'fire from', parts: ['firedAt'], kind: 'pick' },
  { key: 'pushMovement', label: 'push', parts: ['pushMovement'], kind: 'pick' },
  { key: 'mode', label: 'test', parts: ['mode'], kind: 'pick' },
  { key: 'ledge', label: 'climb to', parts: ['ledge'], kind: 'pick' },
  { key: 'metres', label: 'metres', parts: ['metres'], kind: 'steps' },
  { key: 'dive', label: 'dive', parts: ['dive'], kind: 'steps' },
  { key: 'extend', label: 'extend', parts: ['extend'], kind: 'steps' },
  { key: 'modifier', label: 'options', parts: ['modifier', 'leap', 'boost'], kind: 'toggles' },
]

// `command` is null where pressing it gives nothing new: the value a pick has
// now; `bar`, why it cannot be pressed.
export type WalkButton = { label: string; selected: boolean; command: SceneCommand | null; bar?: string | null }

// `now`, the number a `steps` step stands at; `keep`, whether it may be gone
// on from as it is: a pick with nothing chosen yet must be made; `note`,
// what the value it has now gives.
export type WalkStep = { key: WalkKey; label: string; kind: StepKind; buttons: WalkButton[]; now: number | null; keep: boolean; note?: string | null }

// `walk`, the key its passed steps are kept under; `back`, the step walked
// through last, which may be gone back to.
type Walked = { walk: string; step: WalkStep | null; back: WalkKey | null }

// `drop`, the action dropped (cancelled, or passed up where it opened on its own).
export type DeclarationWalk = Walked & {
  kind: 'declare'
  actionId: string
  actorId: string
  title: string
  cost: ActionCost | null
  commit: { label: string; command: SceneCommand; bar: string | null }
  drop: { label: string; command: SceneCommand } | null
}

// `answer`, what they answer with once it is all said; `done`, their word
// that they are done with it, closed while it is not finished, or already
// said, where the answer leaves anything to choose.
export type AnswerWalk = Walked & {
  id: string
  name: string
  target: boolean
  answer: string | null
  cancellable: string | null
  done: { state: 'open' | 'closed' | 'said'; command: SceneCommand } | null
}

// The exchange: each answerer's walk, the one aimed at first; the actor's go,
// closed with why; what else may be pressed, and whom it waits on.
export type ExchangeWalk = {
  kind: 'exchange'
  actionId: string
  actorId: string
  targetId: string | null
  title: string
  answerers: AnswerWalk[]
  heldBack: { id: string; name: string; command: SceneCommand }[]
  go: { label: string; command: SceneCommand; bar: string | null }
  back: SceneCommand | null
  accept: SceneCommand | null
  testMode: WalkButton[]
  awaited: string[]
  hint: string | null
}

export type OpenWalk = DeclarationWalk | ExchangeWalk

const COMMIT_BARS = { declare: 'it is not all declared yet', target: 'pick a target', aim: 'aim it on the board' } as const

// The walk as it stands, or none: nothing it walks is open, or what is open
// has moved past what the popover plays.
export function getOpenWalk(state: SceneState, walk: WalkState): OpenWalk | null {
  const open = getOpenAction(state)
  if (!open) return null
  const ours = walk.actionId === null ? open.actorId === walk.actorId && open.step === 'define' : state.stack.includes(walk.actionId)
  if (!ours) return null
  const passed = (key: string) => walk.passed[key] ?? []
  if (open.step === 'define') return getDeclarationWalk(state, open, open.id === (walk.actionId ?? open.id) ? walk.given : [], passed(walkKey(open.id)))
  if (open.step === 'react') return getExchangeWalk(state, open, (id) => passed(walkKey(open.id, id)))
  return null
}

function getDeclarationWalk(state: SceneState, open: Action, given: readonly WalkKey[], passed: readonly WalkKey[]): DeclarationWalk {
  const steps = stepsOf(getOpenChoices(state).filter((c) => c.actorId === open.actorId))
  const next = getNextStep(state)
  const payable = next === 'commit' && getPayableCost(state, open) !== null
  const holds = next === 'commit' && !payable && getHoldCost(state, open) !== null
  const bar = next === 'declare' || next === 'target' || next === 'aim' ? COMMIT_BARS[next]
    : next !== 'commit' ? 'cannot be committed now'
    : getContestWait(state) ?? (payable || holds ? null : 'not enough AP')
  const drop = getOpenButtons(state).find((b) => b.command.kind === 'cancel' || b.command.kind === 'skip') ?? null
  return {
    kind: 'declare',
    walk: walkKey(open.id),
    actionId: open.id,
    actorId: open.actorId,
    title: titleOf(state, open),
    cost: getOwnCost(state, open),
    ...walked(steps, [...given, ...passed], passed),
    commit: { label: holds ? 'hold' : 'commit', command: { kind: 'commit', args: [] }, bar },
    drop: drop ? { label: drop.label, command: drop.command } : null,
  }
}

function getExchangeWalk(state: SceneState, open: RootAction, passed: (reactorId: string) => readonly WalkKey[]): ExchangeWalk {
  const offers = getActionOffers(state)
  const choices = getOpenChoices(state)
  const buttons = getOpenButtons(state)
  const find = (kind: SceneCommand['kind']) => buttons.find((b) => b.command.kind === kind)?.command ?? null
  const die = needsDie(state, open)
  const go = find(die ? 'roll' : 'pay')
  const targetId = 'targetId' in open ? open.targetId : null
  return {
    kind: 'exchange',
    actionId: open.id,
    actorId: open.actorId,
    targetId,
    title: titleOf(state, open),
    answerers: offers.reactors.map((r) => getAnswerWalk(open, r, choices.filter((c) => c.actorId === r.id), passed(r.id))),
    heldBack: getHeldBackAnswerers(state, open).filter((id) => getHeldBackBar(state, id) === null).map((id) => ({ id, name: getFightName(state, id), command: { kind: 'openAgainstAllies', args: [id] } })),
    go: { label: die ? 'roll' : 'go', command: { kind: die ? 'roll' : 'pay', args: [] }, bar: go ? null : getGoBar(state, open) ?? 'cannot go yet' },
    back: find('back'),
    accept: find('accept'),
    testMode: choices.filter((c) => c.part === 'testMode').map((c) => ({ label: c.label, selected: c.chosen, command: c.chosen ? null : c.command })),
    awaited: offers.reactors.filter((r) => r.awaited).map((r) => r.name),
    hint: getReactionsTo(state, open.id).some((r) => r.kind === 'evasiveJump' && r.to === null) && !areReactionsComplete(state, open) ? 'pick where the evasive jump lands on the board' : null,
  }
}

// An answer a step at a time: what it is (or nothing), the surge it is made
// on where it may be made on another, then what it is declared as.
function getAnswerWalk(open: Action, r: ReactorOptions, choices: OpenChoice[], passed: readonly WalkKey[]): AnswerWalk {
  const chosen = r.answers.find((a) => a.chosen) ?? null
  const answer: WalkStep = {
    key: 'answer',
    label: 'answer',
    kind: 'pick',
    now: null,
    keep: chosen !== null || r.passed,
    buttons: [
      ...r.answers.filter((a) => a.available || a.chosen).map((a): WalkButton => ({ label: a.label, selected: a.chosen, command: a.chosen ? null : { kind: 'react', args: [r.id, a.draft, a.surge] } })),
      ...r.answers.filter((a) => !a.available && !a.chosen).map((a): WalkButton => ({ label: a.label, selected: false, command: null, bar: a.reason ?? 'closed' })),
      { label: r.pass.label, selected: r.passed, command: r.passed ? null : { kind: 'pass', args: [r.id] } },
    ],
  }
  const ways = chosen?.ways.filter((w) => w.available || w.chosen) ?? []
  const way = ways.find((w) => w.chosen)
  const surge: WalkStep | null = ways.length > 1 ? {
    key: 'surge',
    label: 'made on',
    kind: 'pick',
    now: null,
    keep: true,
    note: way?.gives || null,
    buttons: ways.map((w) => ({ label: w.surge ? `${w.surge} surge` : 'no surge', selected: w.chosen, command: w.chosen ? null : { kind: 'react', args: [r.id, w.draft, w.surge] } })),
  } : null
  const steps = [answer, ...(surge ? [surge] : []), ...(chosen ? stepsOf(choices) : [])]
  const done = r.done === null ? null : { state: r.done, command: { kind: 'confirmReaction', args: [r.id] } as SceneCommand }
  return {
    walk: walkKey(open.id, r.id),
    id: r.id,
    name: r.name,
    target: r.target,
    answer: chosen ? `${chosen.label}${way?.surge ? ` on the ${way.surge} surge` : ''}` : r.passed ? r.pass.label : null,
    cancellable: r.cancellable,
    done,
    ...walked(steps, passed, passed),
  }
}

function titleOf(state: SceneState, open: Action): string {
  const label = getOpenLabel(state, open)
  return 'targetId' in open && open.targetId && state.characters[open.targetId] ? `${label} → ${getFightName(state, open.targetId)}` : label
}

function stepsOf(choices: readonly OpenChoice[]): WalkStep[] {
  return STEPS.map((d) => toStep(d, choices.filter((c) => d.parts.includes(c.part)))).filter((s): s is WalkStep => s !== null)
}

function walked(steps: readonly WalkStep[], behind: readonly WalkKey[], passed: readonly WalkKey[]): Pick<Walked, 'step' | 'back'> {
  return {
    step: steps.find((s) => !behind.includes(s.key)) ?? null,
    back: [...passed].reverse().find((key) => steps.some((s) => s.key === key)) ?? null,
  }
}

function toStep(def: StepDef, choices: OpenChoice[]): WalkStep | null {
  const { key, label, kind } = def
  switch (kind) {
    case 'pick': {
      if (!choices.some((c) => !c.chosen)) return null
      return { key, label, kind, now: null, keep: choices.some((c) => c.chosen), buttons: choices.map((c) => ({ label: c.label, selected: c.chosen, command: c.chosen ? null : c.command })) }
    }
    // a toggle comes as its value now and the one a press gives it
    case 'toggles': {
      const names = [...new Set(choices.map((c) => `${c.part}:${c.name ?? c.label}`))]
      const buttons = names.map((n): WalkButton => {
        const both = choices.filter((c) => `${c.part}:${c.name ?? c.label}` === n)
        const now = both.find((c) => c.chosen)
        const press = both.find((c) => !c.chosen)
        return { label: (now ?? press)?.name ?? n, selected: isOn(now), command: press?.command ?? null }
      })
      return buttons.some((b) => b.command !== null) ? { key, label, kind, now: null, keep: true, buttons } : null
    }
    case 'steps': {
      if (choices.length === 0) return null
      return { key, label, kind, now: choices[0].from ?? null, keep: true, buttons: choices.map((c) => ({ label: c.label, selected: false, command: c.command })) }
    }
  }
}

function isOn(c: OpenChoice | undefined): boolean {
  if (!c) return false
  const v = c.value
  return typeof v === 'boolean' ? v : typeof v === 'object' && v !== null && !Array.isArray(v) ? v.on === true : false
}

// The steps of the declaration a pressed entry of the board's menu already
// gives: its row, spell or way of moving, how far it is extended, and the one
// clicked as its target.
export function getGivenSteps(press: MenuPress): WalkKey[] {
  if (press.kind !== 'declare') return []
  const f = press.fields
  return [
    ...('weaponKey' in f ? ['row' as const] : []),
    ...('key' in f ? ['spell' as const] : []),
    ...('movement' in f ? ['movement' as const] : []),
    ...('extend' in f ? ['extend' as const] : []),
    ...(press.aim?.on === 'token' || press.aim?.on === 'floor' ? ['target' as const] : []),
  ]
}
