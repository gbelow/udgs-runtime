import type { SceneState } from '../types'
import type { SceneCommand } from '../commands/registry'
import type { MenuPress } from '../commands/clickMenu'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getOpenAction } from '../rules/log'
import { getContestWait } from '../rules/contest'
import { getHoldCost, getNextStep, getOwnCost, getPayableCost } from '../rules/action'
import { getOpenLabel } from './actionPanel'
import { getFightName } from '../rules/fighters'
import { getOpenButtons } from './buttons'
import { getOpenChoices, type ChoicePart, type OpenChoice } from './choices'

// The open action's declaration as the board's popover walks it: one step at
// a time, each the fills of one part of it (`getOpenChoices`), then the
// commit. A step offers nothing to choose when it has no other value to give,
// and is not shown. Which steps are behind is the screen's to keep: the walk
// is told them, the parts the pressed entry already gave (`getGivenSteps`)
// and the ones walked through since.
//
// A `pick` step takes one value and is done; a `toggles` step switches any of
// its toggles and a `steps` step moves a number a step at a time, and both
// are left by going on.

type StepKind = 'pick' | 'toggles' | 'steps'
type StepDef = { key: ChoicePart; label: string; parts: readonly ChoicePart[]; kind: StepKind }

const STEPS: readonly StepDef[] = [
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

// `command` is null where pressing it gives nothing new: the value a pick has now.
export type WalkButton = { label: string; selected: boolean; command: SceneCommand | null }

// `now`, the number a `steps` step stands at; `keep`, whether it may be gone
// on from as it is: a pick with nothing chosen yet must be made.
export type WalkStep = { key: ChoicePart; label: string; kind: StepKind; buttons: WalkButton[]; now: number | null; keep: boolean }

// `step`, the one to fill now, or none once the commit is all that is left;
// `back`, the step walked through last, which may be gone back to; `drop`,
// the action dropped (cancelled, or passed up where it opened on its own).
export type OpenWalk = {
  actionId: string
  actorId: string
  title: string
  cost: ActionCost | null
  step: WalkStep | null
  back: ChoicePart | null
  commit: { label: string; command: SceneCommand; bar: string | null }
  drop: { label: string; command: SceneCommand } | null
}

const COMMIT_BARS = { declare: 'it is not all declared yet', target: 'pick a target', aim: 'aim it on the board' } as const

export function getOpenWalk(state: SceneState, actorId: string, given: readonly ChoicePart[], passed: readonly ChoicePart[]): OpenWalk | null {
  const open = getOpenAction(state)
  if (!open || open.step !== 'define' || open.actorId !== actorId) return null
  const choices = getOpenChoices(state).filter((c) => c.actorId === actorId)
  const steps = STEPS.map((d) => toStep(d, choices.filter((c) => d.parts.includes(c.part)))).filter((s): s is WalkStep => s !== null)
  const behind = (key: ChoicePart) => given.includes(key) || passed.includes(key)
  const back = [...passed].reverse().find((key) => steps.some((s) => s.key === key)) ?? null
  const next = getNextStep(state)
  const payable = next === 'commit' && getPayableCost(state, open) !== null
  const holds = next === 'commit' && !payable && getHoldCost(state, open) !== null
  const bar = next === 'declare' || next === 'target' || next === 'aim' ? COMMIT_BARS[next]
    : next !== 'commit' ? 'cannot be committed now'
    : getContestWait(state) ?? (payable || holds ? null : 'not enough AP')
  const drop = getOpenButtons(state).find((b) => b.command.kind === 'cancel' || b.command.kind === 'skip') ?? null
  return {
    actionId: open.id,
    actorId,
    title: open.targetId && state.characters[open.targetId] ? `${getOpenLabel(state, open)} → ${getFightName(state, open.targetId)}` : getOpenLabel(state, open),
    cost: getOwnCost(state, open),
    step: steps.find((s) => !behind(s.key)) ?? null,
    back,
    commit: { label: holds ? 'hold' : 'commit', command: { kind: 'commit', args: [] }, bar },
    drop: drop ? { label: drop.label, command: drop.command } : null,
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
export function getGivenSteps(press: MenuPress): ChoicePart[] {
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
