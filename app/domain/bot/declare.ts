import type { ActionDraft, ActionKind, SceneState } from '../scene/types'
import { toUpdater, type CommandContext, type SceneCommand } from '../scene/commands/registry'
import { getAvailableActions } from '../scene/rules/options'
import { getNextStep } from '../scene/rules/action'
import { getOpenAction } from '../scene/rules/log'
import { getActionOffers } from '../scene/projections/actionPanel'
import { getOpenChoices, STEPPED_PARTS, type ChoicePart, type OpenChoice } from '../scene/projections/choices'

// Declares a decision as the presses a person would make: the option, then
// each part of it the intent names, as the open choices offer it
// (`getOpenChoices`), then the commit. It decides nothing: the intent names
// every part a step asks for, and a part the table fills by default (where a
// strike aims, the gear a spell is cast with) stays as the table leaves it
// unless the intent names it. Whatever the intent names that is not offered,
// whatever a step still asks for that it does not name, and any press that
// does nothing, is refused, and the refusal says which part.
//
// Pure: it reads and presses on the state it is given, so a declaration can be
// tried on the side, and the commands it returns are the ones to send to the
// table. An answer to the open action is declared the same way, with no commit.

export type Pick = { part: ChoicePart; value: unknown }

export type Intent = {
  actorId: string
  // the option declared or the answer given, matched by the fields named
  // against the drafts the panel offers
  option: Partial<ActionDraft> & { kind: ActionKind }
  picks: Pick[]
}

export type Declared =
  // `ready` is the declaration complete and not yet committed (an answer is
  // ready once declared); `state` is after the commit
  | { ok: true; commands: SceneCommand[]; ready: SceneState; state: SceneState }
  | { ok: false; commands: SceneCommand[]; state: SceneState; refused: string }

// a value as text with its keys in order, so two values that say the same compare equal
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b)

// parts no choice is ever marked chosen for: once pressed, they are made
const PRESSED_ONCE: readonly ChoicePart[] = ['cell', 'overflow', 'improve', 'grazeSave', 'restMove']

export function declare(start: SceneState, intent: Intent, ctx: CommandContext): Declared {
  const commands: SceneCommand[] = []
  let state = start
  const refuse = (refused: string): Declared => ({ ok: false, commands, state, refused })
  const press = (command: SceneCommand): boolean => {
    const next = toUpdater(command, ctx)(state)
    if (next === state) return false
    commands.push(command)
    state = next
    return true
  }

  const { actorId } = intent
  const answering = getOpenAction(state)
  const offered = getAvailableActions(state, actorId).filter((o) => o.available && o.reactionTo === (answering?.step === 'react' ? answering.id : null))
  const matching = offered.filter((o) => Object.entries(intent.option).every(([k, v]) => same((o.draft as Record<string, unknown>)[k], v)))
  const drafts = [...new Map(matching.map((o) => [canon(o.draft), o.draft])).values()]
  if (drafts.length === 0) return refuse(`${intent.option.kind} is not offered to ${actorId} as named`)
  if (drafts.length > 1) return refuse(`${intent.option.kind} as named matches ${drafts.length} options: name more of it`)
  const answer = answering?.step === 'react'
  if (!press(answer ? { kind: 'react', args: [actorId, drafts[0]] } : { kind: 'declare', args: [actorId, drafts[0]] })) return refuse(`declaring ${intent.option.kind} did nothing`)

  const mine = () => getOpenChoices(state).filter((c) => c.actorId === actorId)
  const made = new Set<number>()
  const isMade = (i: number, choices: OpenChoice[]): boolean => {
    const { part, value } = intent.picks[i]
    if (PRESSED_ONCE.includes(part)) return made.has(i)
    const of = choices.filter((c) => c.part === part)
    if (STEPPED_PARTS.includes(part)) return of.length > 0 && of[0].from === value
    return of.some((c) => c.chosen && same(c.value, value))
  }
  for (let round = 0; round < intent.picks.length * 3 + 3; round++) {
    let moved = false
    for (let i = 0; i < intent.picks.length; i++) {
      const choices = mine()
      if (isMade(i, choices)) continue
      const { part, value } = intent.picks[i]
      const of = choices.filter((c) => c.part === part && !c.chosen)
      const step = STEPPED_PARTS.includes(part) && typeof value === 'number'
        ? of.filter((c) => typeof c.value === 'number' && c.from !== undefined && Math.abs((c.value as number) - value) < Math.abs(c.from - value))[0]
        : of.find((c) => same(c.value, value))
      if (!step) continue
      if (!press(step.command)) return refuse(`${part} ${canon(value)} is offered but pressing it does nothing`)
      if (PRESSED_ONCE.includes(part)) made.add(i)
      moved = true
    }
    if (!moved) break
  }

  const choices = mine()
  const unmade = intent.picks.map((p, i) => ({ p, i })).filter(({ i }) => !isMade(i, choices))
  if (unmade.length) {
    const { p } = unmade[0]
    const values = choices.filter((c) => c.part === p.part).map((c) => canon(c.value))
    const still = !answer && getNextStep(state) === 'declare' ? `; the declaration still asks for ${asked(choices)}` : ''
    return refuse(`${p.part} ${canon(p.value)} is not offered${values.length ? `: offered ${values.slice(0, 8).join(', ')}${values.length > 8 ? ', ...' : ''}` : ''}${still}`)
  }

  if (answer) {
    const strike = getActionOffers(state).reactors.find((r) => r.id === actorId)?.strike
    if (strike && !strike.complete) return refuse(`the answer still asks for ${asked(choices)}`)
    return { ok: true, commands, ready: state, state }
  }
  const step = getNextStep(state)
  if (step !== 'commit') return refuse(`the declaration still asks for ${step === 'declare' ? asked(choices) : step}`)
  const ready = state
  if (!press({ kind: 'commit', args: [] })) return refuse('the commit was refused')
  return { ok: true, commands, ready, state }
}

// the parts offered that have nothing chosen yet
function asked(choices: OpenChoice[]): string {
  const parts = [...new Set(choices.map((c) => c.part))].filter((part) => !choices.some((c) => c.part === part && c.chosen))
  return parts.length ? parts.join(', ') : 'something the open choices do not offer'
}
