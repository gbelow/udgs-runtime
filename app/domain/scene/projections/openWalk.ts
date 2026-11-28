import type { Action, RootAction, SceneState } from '../types'
import type { SceneCommand } from '../commands/registry'
import type { MenuPress } from '../commands/clickMenu'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getAncestry, getOpenAction, getReactionsTo } from '../rules/log'
import { getContestWait } from '../rules/contest'
import { areReactionsComplete, getHoldCost, getNextStep, getOwnCost, getPayableCost, needsDie } from '../rules/action'
import { getGoBar } from '../rules/options'
import { getHeldBackAnswerers, getHeldBackBar } from '../rules/reactions'
import { getFightName } from '../rules/fighters'
import { getHeavyBase } from '../rules/modifiers'
import { getHitHOP } from '../rules/damage'
import { HOP_EFFECTS } from '../../tables'
import { getCastHOPRemaining } from '../rules/cast'
import { isAttackAction } from '../rules/actionCatalog'
import type { Degree } from '../../types'
import type { Damage } from '../../character/rules/gear'
import { getActionOffers, getOpenLabel, type ReactorOptions } from './actionPanel'
import { getOpenButtons } from './buttons'
import { getOpenChoices, type ChoicePart, type OpenChoice } from './choices'

// The action the board's popover declared, walked where the popover was: its
// declaration one step at a time, each the fills of one part of it
// (`getOpenChoices`), then the commit; then the exchange, each answerer's
// answer a step at a time (what it is, the surge it is made on, what it is
// declared as, their word that they are done), and the actor's go; then,
// once its die is thrown, what it lands with a step at a time (what the
// overflow buys, what the hit takes), and its landing. Whatever comes of it
// is walked the same way while it is open: an action a reaction opens on top
// of it, and the follow-ups it leaves when it lands, and theirs. A step
// offers nothing to choose when it has no other value to give, and is not
// shown.
//
// Which steps are behind is the screen's to keep (`WalkState`): the walk is
// told the parts the pressed entry already gave (`getGivenSteps`) and, for
// each action and each answerer to it, the steps walked through since.
//
// A `pick` step takes one value and is done; a `toggles` step switches any of
// its toggles and a `steps` step moves a number a step at a time, and both
// are left by going on. A strike that may be heavy picks its degree as a step
// of its own (`heavy`), the attack made at no degree declared picked to begin
// with.

export type WalkKey = ChoicePart | 'answer' | 'heavy'

// `actionId`, the action walked, once it is seen open; `given`, the steps of
// its declaration the entry gave; `passed`, keyed by `walkKey`.
export type WalkState = { actorId: string; actionId: string | null; given: readonly WalkKey[]; passed: Readonly<Record<string, readonly WalkKey[]>> }

// Whose steps a list of passed steps is: an action's declaration, one
// answerer's answer to it, or what it lands with.
export const walkKey = (actionId: string, reactorId: string | null = null) => (reactorId ? `${actionId}:${reactorId}` : actionId)
const landingKey = (actionId: string) => `${actionId}#landing`

// A `buys` step buys any of its values, some more than once, and takes them back.
type StepKind = 'pick' | 'toggles' | 'steps' | 'buys'
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
// now; `bar`, why it cannot be pressed; of a value bought, how many times it
// is (`count`) and what takes one back (`undo`); `damage`, the blow an attack
// row or a heavy degree lands; `cost`, what pressing it declares costs, and
// `note`, what it is made with (a surge, and what the surge gives).
// `hint`, what it does, told on hover.
export type WalkButton = { label: string; selected: boolean; command: SceneCommand | null; bar?: string | null; count?: number; undo?: SceneCommand | null; damage?: Damage; cost?: ActionCost | null; note?: string | null; hint?: string }

// `now`, the number a `steps` step stands at; `keep`, whether it may be gone
// on from as it is: a pick with nothing chosen yet must be made; `note`,
// what the value it has now gives.
export type WalkStep = { key: WalkKey; label: string; kind: StepKind; buttons: WalkButton[]; now: number | null; keep: boolean; note?: string | null }

// `walk`, the key its passed steps are kept under; `back`, the step walked
// through last, which may be gone back to.
type Walked = { walk: string; step: WalkStep | null; back: WalkKey | null }

// `drop`, the action dropped (cancelled, or passed up where it opened on its
// own); `summary`, what it is declared with as it stands, part by part;
// `aimed`, the character or item it is aimed at.
export type DeclarationWalk = Walked & {
  kind: 'declare'
  actionId: string
  actorId: string
  aimed: string | null
  title: string
  cost: ActionCost | null
  summary: { label: string; value: string }[]
  commit: { label: string; command: SceneCommand; bar: string | null }
  drop: { label: string; command: SceneCommand } | null
}

// Where a reactor stands: the action waits on their reaction (`waiting`),
// or they may react and it does not wait (`open`); they have reacted and
// are still saying what with, or the action waits on their word
// (`reacting`); they react with nothing (`passed`) or are done (`done`).
export type ReactorStatus = 'waiting' | 'open' | 'reacting' | 'passed' | 'done'

// `answer`, what they react with once it is all said; `done`, their word
// that they are done with it, closed while it is not finished, or already
// said, where the reaction leaves anything to choose.
export type AnswerWalk = Walked & {
  id: string
  name: string
  target: boolean
  status: ReactorStatus
  answer: string | null
  cancellable: string | null
  done: { state: 'open' | 'closed' | 'said'; command: SceneCommand } | null
}

// The exchange: each reactor's walk, the one aimed at first, and how many
// of them have reacted or passed (`reacted`); the actor's go, closed with
// why; what else may be pressed, and whom it waits on. Once the go is open,
// nobody is in the middle of a reaction and nobody has anything left to say,
// the go is all there is (`settled`), and it goes on its own.
export type ExchangeWalk = {
  kind: 'exchange'
  actionId: string
  actorId: string
  targetId: string | null
  title: string
  answerers: AnswerWalk[]
  reacted: number
  heldBack: { id: string; name: string; command: SceneCommand }[]
  go: { label: string; command: SceneCommand; bar: string | null }
  back: SceneCommand | null
  accept: SceneCommand | null
  testMode: WalkButton[]
  awaited: string[]
  hint: string | null
  settled: boolean
}

// What the action lands with, a step at a time, then its landing, closed
// with why while something is still to be chosen; `last`, whether the step
// shown is the last to go on from before it lands.
// `result`, how the roll came out: its degree, the die, the score it made
// and the DL it stood against; `hop`, the overflow it has to spend, and how
// much of it is left.
export type LandingWalk = Walked & {
  kind: 'land'
  actionId: string
  actorId: string
  title: string
  result: { degree: Degree; die: number; score: number; DL: number } | null
  hop: { remaining: number; total: number } | null
  last: boolean
  land: { command: SceneCommand; bar: string | null }
}

export type OpenWalk = DeclarationWalk | ExchangeWalk | LandingWalk

const COMMIT_BARS = { declare: 'it is not all declared yet', target: 'pick a target', aim: 'aim it on the board' } as const

// The walk as it stands, or none: nothing it walks is open, or what is open
// has moved past what the popover plays.
// Where the open action stands: its step, and of its reactions whether they
// are all in. A walk put away comes back once this moves on.
export function getOpenStage(state: SceneState): string | null {
  const open = getOpenAction(state)
  return open ? `${open.id}:${open.step}:${open.step === 'react' && areReactionsComplete(state, open)}` : null
}

// A declaration aimed anew while it is walked (on the board, or by its
// step): its target step is gone on from, as a press of it would be.
export function getAimedStep(before: OpenWalk | null, after: OpenWalk | null): { walk: string; key: WalkKey } | null {
  if (before?.kind !== 'declare' || after?.kind !== 'declare' || before.walk !== after.walk) return null
  return after.aimed !== null && after.aimed !== before.aimed ? { walk: after.walk, key: 'target' } : null
}

export function getOpenWalk(state: SceneState, walk: WalkState): OpenWalk | null {
  const open = getOpenAction(state)
  if (!open) return null
  const id = walk.actionId
  const ours = id === null ? open.actorId === walk.actorId && open.step === 'define' : open.id === id || state.stack.includes(id) || getAncestry(state, open).some((a) => a.id === id)
  if (!ours) return null
  const passed = (key: string) => walk.passed[key] ?? []
  if (open.step === 'define') return getDeclarationWalk(state, open, open.id === (walk.actionId ?? open.id) ? walk.given : [], passed(walkKey(open.id)))
  if (open.step === 'react') return getExchangeWalk(state, open, (reactor) => passed(walkKey(open.id, reactor)))
  return getLandingWalk(state, open, passed(landingKey(open.id)))
}

const LANDING_STEPS: readonly StepDef[] = [
  { key: 'grapple', label: 'on the hit', parts: ['grapple'], kind: 'toggles' },
  { key: 'theft', label: 'on the hit', parts: ['theft'], kind: 'pick' },
  { key: 'along', label: 'on a hit', parts: ['along'], kind: 'toggles' },
  { key: 'grappling', label: 'the maneuver does', parts: ['grappling'], kind: 'pick' },
  { key: 'disarm', label: 'take', parts: ['disarm'], kind: 'pick' },
  { key: 'sighting', label: 'noticed', parts: ['sighting'], kind: 'pick' },
]

const LAND_BARS = { choose: 'choose what the hit takes first', react: 'the reactions are not in yet' } as const

// What the thrown action lands with: what its overflow buys and what a
// cast's buys, then what the hit takes, the graze a cast may save and the
// tread a rest allows.
function getLandingWalk(state: SceneState, open: RootAction, passed: readonly WalkKey[]): LandingWalk {
  const offers = getActionOffers(state)
  const choices = getOpenChoices(state).filter((c) => c.actorId === open.actorId)
  const next = getNextStep(state)
  // only what may be bought now, or taken back
  const buyable = offers.hopOptions.filter((o) => o.available || o.bought > 0)
  const improvable = offers.castHOP.options.filter((o) => o.available || o.times > 0)
  const overflow: WalkStep | null = next === 'spend' && buyable.length > 0 ? {
    key: 'overflow', label: 'overflow', kind: 'buys', now: null, keep: true,
    buttons: buyable.map((o) => ({ label: `${o.label} ${o.cost} HOP`, selected: o.bought > 0, count: o.bought, command: { kind: 'spend', args: [o.purchase] }, bar: o.available ? null : o.reason ?? 'closed', undo: o.bought > 0 && o.refundable ? { kind: 'refund', args: [o.purchase] } : null, hint: HOP_EFFECTS[o.purchase].text })),
  } : null
  const improve: WalkStep | null = next === 'spend' && improvable.length > 0 ? {
    key: 'improve', label: 'improve', kind: 'buys', now: offers.castHOP.remaining, keep: true,
    buttons: improvable.map((o) => ({ label: `${o.name} ${o.HOP} HOP`, selected: o.times > 0, count: o.times, command: { kind: 'improve', args: [o.name] }, bar: o.available ? null : 'not enough HOP', undo: o.times > 0 ? { kind: 'unimprove', args: [o.name] } : null, hint: o.text })),
  } : null
  const once = (key: WalkKey, label: string, button: string, command: SceneCommand): WalkStep => ({ key, label, kind: 'pick', now: null, keep: true, buttons: [{ label: button, selected: false, command }] })
  const steps = [
    ...(overflow ? [overflow] : []),
    ...(improve ? [improve] : []),
    ...LANDING_STEPS.map((d) => toStep(d, choices.filter((c) => d.parts.includes(c.part)))).filter((s): s is WalkStep => s !== null),
    ...(offers.grazeSave ? [once('grazeSave', 'graze', 'save the graze', { kind: 'grazeSave', args: [] })] : []),
    ...(offers.restMove ? [once('restMove', 'rest', 'tread', { kind: 'restMove', args: [] })] : []),
  ]
  const landable = getOpenButtons(state).some((b) => b.command.kind === 'resolve')
  const roll = 'roll' in open ? open.roll : null
  const hop = isAttackAction(open) ? getHitHOP(state, open) : open.kind === 'cast' ? { remaining: getCastHOPRemaining(open), total: open.roll?.HOP ?? 0 } : null
  return {
    kind: 'land',
    walk: landingKey(open.id),
    actionId: open.id,
    actorId: open.actorId,
    title: titleOf(state, open),
    result: roll ? { degree: roll.degree, die: roll.die, score: roll.score, DL: roll.DL } : null,
    hop: hop && hop.total > 0 ? { remaining: hop.remaining, total: hop.total } : null,
    ...walked(steps, passed, passed),
    last: steps.filter((s) => !passed.includes(s.key)).length === 1,
    land: { command: { kind: 'resolve', args: [] }, bar: landable ? null : next === 'choose' || next === 'react' ? LAND_BARS[next] : 'cannot land yet' },
  }
}

function getDeclarationWalk(state: SceneState, open: Action, given: readonly WalkKey[], passed: readonly WalkKey[]): DeclarationWalk {
  const choices = getOpenChoices(state).filter((c) => c.actorId === open.actorId)
  const base = getHeavyBase(state, open)
  const steps = stepsOf(choices, base)
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
    aimed: 'targetId' in open && open.targetId ? open.targetId : 'object' in open && open.object ? open.object : null,
    title: titleOf(state, open),
    cost: getOwnCost(state, open),
    summary: summaryOf(choices, base),
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
  const reactions = getReactionsTo(state, open.id)
  const answerers = offers.reactors.map((r) => {
    const reaction = reactions.find((a) => a.actorId === r.id)
    return getAnswerWalk(open, r, choices.filter((c) => c.actorId === r.id), passed(r.id), reaction ? getHeavyBase(state, reaction) : null)
  })
  const heldBack = getHeldBackAnswerers(state, open).filter((id) => getHeldBackBar(state, id) === null).map((id) => ({ id, name: getFightName(state, id), command: { kind: 'openAgainstAllies' as const, args: [id] as [string] } }))
  const accept = find('accept')
  return {
    kind: 'exchange',
    actionId: open.id,
    actorId: open.actorId,
    targetId,
    title: titleOf(state, open),
    answerers,
    reacted: answerers.filter((a) => a.status === 'passed' || a.status === 'done').length,
    heldBack,
    go: { label: die ? 'roll' : 'go', command: { kind: die ? 'roll' : 'pay', args: [] }, bar: go ? null : getGoBar(state, open) ?? 'cannot go yet' },
    back: find('back'),
    accept,
    testMode: choices.filter((c) => c.part === 'testMode').map((c) => ({ label: c.label, selected: c.chosen, command: c.chosen ? null : c.command })),
    awaited: offers.reactors.filter((r) => r.awaited).map((r) => r.name),
    hint: getReactionsTo(state, open.id).some((r) => r.kind === 'evasiveJump' && r.to === null) && !areReactionsComplete(state, open) ? 'pick where the evasive jump lands on the board' : null,
    settled: go !== null && accept === null && heldBack.length === 0 && answerers.every((a) => a.status !== 'waiting' && a.status !== 'reacting'),
  }
}

// A reaction a step at a time: what it is, made each way it may be made (with
// no surge or on one, a tile for each, as an attack has one for each row), or
// nothing; then what it is declared as. A surge it is made on says what it
// gives, and so does the surge the reactor is on already.
function getAnswerWalk(open: Action, r: ReactorOptions, choices: OpenChoice[], passed: readonly WalkKey[], base: HeavyBase): AnswerWalk {
  const chosen = r.answers.find((a) => a.chosen) ?? null
  const way = chosen?.ways.find((w) => w.chosen)
  const noteOf = (surge: string | null, gives: string) => (surge ? `${surge} surge${gives ? ` ${gives}` : ''}` : null)
  const onAlready = r.surge ? noteOf(r.surge.kind, r.surge.gives) : null
  const answer: WalkStep = {
    key: 'answer',
    label: 'reaction',
    kind: 'pick',
    now: null,
    keep: chosen !== null || r.passed,
    buttons: [
      ...r.answers.flatMap((a): WalkButton[] => {
        const ways = a.ways.filter((w) => w.available || w.chosen)
        if (ways.length === 0) return [{ label: a.label, selected: false, command: null, bar: a.reason ?? 'closed', cost: a.cost }]
        return ways.map((w) => ({ label: a.label, selected: w.chosen, cost: w.cost, note: noteOf(w.surge, w.gives) ?? onAlready, command: w.chosen ? null : { kind: 'react', args: [r.id, w.draft, w.surge] } }))
      }),
      { label: r.pass.label, selected: r.passed, command: r.passed ? null : { kind: 'pass', args: [r.id] } },
    ],
  }
  const steps = [answer, ...(chosen ? stepsOf(choices, base) : [])]
  const done = r.done === null ? null : { state: r.done, command: { kind: 'confirmReaction', args: [r.id] } as SceneCommand }
  return {
    walk: walkKey(open.id, r.id),
    id: r.id,
    name: r.name,
    target: r.target,
    status: r.passed ? 'passed' : !chosen ? (r.awaited ? 'waiting' : 'open') : r.awaited || r.done === 'open' || r.done === 'closed' ? 'reacting' : 'done',
    answer: chosen ? `${chosen.label}${way?.surge ? ` on the ${way.surge} surge` : ''}` : r.passed ? r.pass.label : null,
    cancellable: r.cancellable,
    done,
    ...walked(steps, passed, passed),
  }
}

// Which reactor the exchange shows of those offered a reaction, one at a
// time: the one picked (`pick`), while they are not finished or were picked
// to be looked at again (`review`); else the first of the viewer's own
// (`controlled`) the action waits on, or who has yet to finish, the one aimed
// at first; else whoever was picked, or the first. A reactor is finished
// once they passed or are done and their walk is at its end, so one who is
// done moves the exchange on to the next of the viewer's own.
export type ReactorPick = { id: string; review: boolean }

export const isFinished = (a: AnswerWalk) => (a.status === 'passed' || a.status === 'done') && a.step === null

export function getShownReactor(answerers: readonly AnswerWalk[], controlled: readonly string[], pick: ReactorPick | null): string | null {
  const picked = pick ? answerers.find((a) => a.id === pick.id) : undefined
  if (picked && pick && (pick.review || !isFinished(picked))) return picked.id
  const own = answerers.filter((a) => controlled.includes(a.id))
  const next = own.find((a) => (a.status === 'waiting' || a.status === 'reacting') && !isFinished(a)) ?? own.find((a) => !isFinished(a))
  return (next ?? picked ?? own[0] ?? answerers[0])?.id ?? null
}

// Whether the exchange opens shown whole: some of the viewer's own are waited on.
export function hasOwnToReact(answerers: readonly AnswerWalk[], controlled: readonly string[]): boolean {
  return answerers.some((a) => controlled.includes(a.id) && (a.status === 'waiting' || a.status === 'reacting') && !isFinished(a))
}

function titleOf(state: SceneState, open: Action): string {
  const label = getOpenLabel(state, open)
  return 'targetId' in open && open.targetId && state.characters[open.targetId] ? `${label} → ${getFightName(state, open.targetId)}` : label
}

type HeavyBase = ReturnType<typeof getHeavyBase>

const isHeavy = (c: OpenChoice) => c.part === 'modifier' && typeof c.value === 'object' && c.value !== null && !Array.isArray(c.value) && typeof c.value.key === 'string' && /^heavy\d+$/.test(c.value.key)

// The declaration's steps, the heavy degree picked right after the attack.
function stepsOf(choices: readonly OpenChoice[], base: HeavyBase): WalkStep[] {
  const rest = choices.filter((c) => !isHeavy(c))
  const steps = STEPS.map((d) => toStep(d, rest.filter((c) => d.parts.includes(c.part)))).filter((s): s is WalkStep => s !== null)
  const heavy = heavyStep(choices.filter(isHeavy), base)
  if (!heavy) return steps
  const row = STEPS.findIndex((d) => d.key === 'row')
  const at = steps.findIndex((s) => STEPS.findIndex((d) => d.key === s.key) > row)
  return at < 0 ? [...steps, heavy] : [...steps.slice(0, at), heavy, ...steps.slice(at)]
}

// combat.tex "Heavy Attack": the degree the strike is made at, one of them
// picked at a time; the attack at no degree declared (`base`) is picked
// while none is, and pressing it takes the one declared back. A degree's
// two values press the same toggle, so either carries its command.
function heavyStep(choices: readonly OpenChoice[], base: HeavyBase): WalkStep | null {
  if (choices.length === 0 || !base) return null
  const names = [...new Set(choices.map((c) => c.name ?? c.label))]
  const degrees = names.map((n) => {
    const both = choices.filter((c) => (c.name ?? c.label) === n)
    const on = both.some((c) => c.chosen && isOn(c))
    return { label: n, on, command: both[0].command, damage: both[0].damage }
  })
  const declared = degrees.find((d) => d.on)
  const buttons: WalkButton[] = [
    { label: base.label, selected: !declared, command: declared ? declared.command : null, damage: base.damage },
    ...degrees.map((d): WalkButton => ({ label: d.label, selected: d.on, command: d.on ? null : d.command, ...(d.damage ? { damage: d.damage } : {}) })),
  ]
  return { key: 'heavy', label: 'heavy', kind: 'pick', now: null, keep: true, buttons }
}

// What the action is declared with, part by part: of each pick its value,
// of the toggles those on, of a part stepped the value it stands at.
function summaryOf(choices: readonly OpenChoice[], base: HeavyBase): { label: string; value: string }[] {
  const heavy = choices.filter((c) => isHeavy(c) && c.chosen && isOn(c)).map((c) => c.name ?? c.label)
  const rest = choices.filter((c) => !isHeavy(c))
  const parts = STEPS.flatMap((d): { label: string; value: string }[] => {
    const mine = rest.filter((c) => d.parts.includes(c.part))
    if (mine.length === 0) return []
    if (d.kind === 'steps') return mine[0].from !== undefined ? [{ label: d.label, value: String(mine[0].from) }] : []
    if (d.kind === 'toggles') {
      const on = [...new Set(mine.filter((c) => c.chosen && isOn(c)).map((c) => c.name ?? c.label))]
      return on.length > 0 ? [{ label: d.label, value: on.join(', ') }] : []
    }
    const picked = mine.find((c) => c.chosen)
    return picked ? [{ label: d.label, value: picked.label }] : []
  })
  if (!base || !choices.some(isHeavy)) return parts
  const at = parts.findIndex((p) => p.label === 'attack')
  const line = { label: 'heavy', value: heavy[0] ?? base.label }
  return at < 0 ? [line, ...parts] : [...parts.slice(0, at + 1), line, ...parts.slice(at + 1)]
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
      return { key, label, kind, now: null, keep: choices.some((c) => c.chosen), buttons: choices.map((c) => ({ label: c.label, selected: c.chosen, command: c.chosen ? null : c.command, ...(c.damage ? { damage: c.damage } : {}) })) }
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
    case 'buys':
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
