import type { ActionDraft, ActionKind, SceneState } from '../scene/types'
import { toUpdater, type CommandContext, type SceneCommand } from '../scene/commands/registry'
import { getAvailableActions } from '../scene/rules/options'
import { getNextStep } from '../scene/rules/action'
import { getOpenAction } from '../scene/rules/log'
import { shareReach } from '../scene/rules/board/reach'
import { getReachMove } from './reach'
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
// What is chosen once the die is thrown is settled the same way (`settle`).

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

// parts no choice is ever marked chosen for: once pressed, they are made, and
// one named twice is pressed twice (an overflow purchase bought twice)
const PRESSED_ONCE: readonly ChoicePart[] = ['cell', 'overflow', 'improve', 'grazeSave', 'restMove']

// The presses made so far on the state they lead to.
type Presses = { state: SceneState; commands: SceneCommand[]; press: (command: SceneCommand) => boolean }

function pressing(start: SceneState, ctx: CommandContext, after: (state: SceneState) => void = () => {}): Presses {
  const p: Presses = {
    state: start,
    commands: [],
    press: (command) => {
      const next = toUpdater(command, ctx)(p.state)
      if (next === p.state) return false
      p.commands.push(command)
      p.state = next
      after(next)
      return true
    },
  }
  return p
}

// Presses each pick as the open choices offer it to the actor, in whatever
// order they come to be offered, until every pick is made or none can be.
// The pick the choices did not take, or a press that did nothing, as a
// refusal; null once every pick is made.
function fillIn(p: Presses, actorId: string, picks: readonly Pick[]): string | null {
  const mine = () => getOpenChoices(p.state).filter((c) => c.actorId === actorId)
  const made = new Set<number>()
  const isMade = (i: number, choices: OpenChoice[]): boolean => {
    const { part, value } = picks[i]
    if (PRESSED_ONCE.includes(part)) return made.has(i)
    const of = choices.filter((c) => c.part === part)
    if (STEPPED_PARTS.includes(part)) return of.length > 0 && of[0].from === value
    return of.some((c) => c.chosen && same(c.value, value))
  }
  for (let round = 0; round < picks.length * 3 + 3; round++) {
    let moved = false
    for (let i = 0; i < picks.length; i++) {
      const choices = mine()
      if (isMade(i, choices)) continue
      const { part, value } = picks[i]
      const of = choices.filter((c) => c.part === part && !c.chosen)
      const step = STEPPED_PARTS.includes(part) && typeof value === 'number'
        ? of.filter((c) => typeof c.value === 'number' && c.from !== undefined && Math.abs((c.value as number) - value) < Math.abs(c.from - value))[0]
        : of.find((c) => same(c.value, value))
      if (!step) continue
      if (!p.press(step.command)) return `${part} ${canon(value)} is offered but pressing it does nothing`
      if (PRESSED_ONCE.includes(part)) made.add(i)
      moved = true
    }
    if (!moved) break
  }
  const choices = mine()
  const unmade = picks.find((_, i) => !isMade(i, choices))
  if (!unmade) return null
  const values = choices.filter((c) => c.part === unmade.part).map((c) => canon(c.value))
  return `${unmade.part} ${canon(unmade.value)} is not offered${values.length ? `: offered ${values.slice(0, 8).join(', ')}${values.length > 8 ? ', ...' : ''}` : ''}`
}

export function declare(start: SceneState, intent: Intent, ctx: CommandContext): Declared {
  const { actorId } = intent
  // a move getReach (bot/reach.ts) declared on this same state has had its
  // reach walked: the same move declared here shares it
  const walked = getReachMove(start, actorId)
  const p = pressing(start, ctx, (state) => { if (walked) shareReach(walked, state) })
  const refuse = (refused: string): Declared => ({ ok: false, commands: p.commands, state: p.state, refused })

  const answering = getOpenAction(start)
  const answer = answering?.step === 'react'
  const offered = getAvailableActions(start, actorId).filter((o) => o.available && o.reactionTo === (answer ? answering.id : null))
  const matching = offered.filter((o) => Object.entries(intent.option).every(([k, v]) => same((o.draft as Record<string, unknown>)[k], v)))
  const drafts = [...new Map(matching.map((o) => [canon(o.draft), o.draft])).values()]
  if (drafts.length === 0) return refuse(`${intent.option.kind} is not offered to ${actorId} as named`)
  if (drafts.length > 1) return refuse(`${intent.option.kind} as named matches ${drafts.length} options: name more of it`)
  if (!p.press(answer ? { kind: 'react', args: [actorId, drafts[0]] } : { kind: 'declare', args: [actorId, drafts[0]] })) return refuse(`declaring ${intent.option.kind} did nothing`)

  const unmade = fillIn(p, actorId, intent.picks)
  const choices = () => getOpenChoices(p.state).filter((c) => c.actorId === actorId)
  if (unmade) return refuse(`${unmade}${!answer && getNextStep(p.state) === 'declare' ? `; the declaration still asks for ${asked(choices())}` : ''}`)

  if (answer) {
    const strike = getActionOffers(p.state).reactors.find((r) => r.id === actorId)?.strike
    if (strike && !strike.complete) return refuse(`the answer still asks for ${asked(choices())}`)
    return { ok: true, commands: p.commands, ready: p.state, state: p.state }
  }
  const step = getNextStep(p.state)
  if (step !== 'commit') return refuse(`the declaration still asks for ${step === 'declare' ? asked(choices()) : step}`)
  const ready = p.state
  if (!p.press({ kind: 'commit', args: [] })) return refuse('the commit was refused')
  return { ok: true, commands: p.commands, ready, state: p.state }
}

// What is chosen once the open action's die is thrown, pressed as the table
// offers it to its actor: what the overflow buys (a purchase named as often as
// it is bought), a grapple or a theft on the hit, a spell's improvements, a
// graze saved, what a won grapple maneuver does; then the action landed,
// unless `land` is false. `ready` is the action with everything chosen, not
// yet landed. Refused, as a declaration is, for a pick not offered, a press
// that does nothing, or a step that still asks for something.
export function settle(start: SceneState, picks: readonly Pick[], ctx: CommandContext, land = true): Declared {
  const p = pressing(start, ctx)
  const refuse = (refused: string): Declared => ({ ok: false, commands: p.commands, state: p.state, refused })
  const open = getOpenAction(start)
  if (open?.step !== 'post') return refuse('nothing rolled waits to be settled')
  const unmade = fillIn(p, open.actorId, picks)
  if (unmade) return refuse(unmade)
  const step = getNextStep(p.state)
  if (step !== 'confirm' && step !== 'spend') return refuse(`the action still asks for ${step === 'choose' ? asked(getOpenChoices(p.state).filter((c) => c.actorId === open.actorId)) : step}`)
  const ready = p.state
  if (land && !p.press({ kind: 'resolve', args: [] })) return refuse('landing it was refused')
  return { ok: true, commands: p.commands, ready, state: p.state }
}

// the parts offered that have nothing chosen yet
function asked(choices: OpenChoice[]): string {
  const parts = [...new Set(choices.map((c) => c.part))].filter((part) => !choices.some((c) => c.part === part && c.chosen))
  return parts.length ? parts.join(', ') : 'something the open choices do not offer'
}
