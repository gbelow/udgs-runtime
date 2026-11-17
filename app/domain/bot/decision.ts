import type { SceneState } from '../scene/types'
import type { CommandContext, SceneCommand } from '../scene/commands/registry'
import type { OpenButton } from '../scene/projections/buttons'
import type { OpenChoice } from '../scene/projections/choices'
import type { Wait } from './table'
import { declare, settle, type Intent, type Pick as Fill } from './declare'
import { getOpenAction } from '../scene/rules/log'

// What comes out of a decision box, and what goes into it. The box is a pure
// function of what its seat may know (`SeatInput`) to one decision, with the
// reason for it, for the log. What is open to the seat is read off the fight
// itself and kept to its members, as the panels of a player in the seat read
// it; what the seat may know of the fight is the fight as it sees it (`view`).
// Whatever it decides is turned into presses here (`toCommands`), refused when
// it is not open to the seat; the presses are then sent to the table as the
// seat, which refuses again what the seat may not do.

export type Decision = { why: string } & (
  // one of the buttons or choices in the input, pressed as it is offered
  | { kind: 'press'; pick: OpenButton | OpenChoice }
  // an option declared and committed, or an answer given, spelled out whole
  // (bot/declare.ts)
  | { kind: 'declare'; intent: Intent }
  // what is chosen once the open action's die is thrown, then landed unless
  // `land` is false
  | { kind: 'settle'; picks: Fill[]; land?: boolean }
  // nothing from this seat now
  | { kind: 'wait' }
)

export type SeatInput = {
  // the characters the seat plays
  members: readonly string[]
  // the fight as the seat sees it (bot/belief.ts), read when asked for
  view: () => SceneState
  // what the table waits on the seat for
  waits: readonly Wait[]
  // the buttons open to the seat, and the choices open to its members
  buttons: readonly OpenButton[]
  choices: readonly OpenChoice[]
  // the characters in view that one of the seat's members does not notice,
  // so cannot aim at, as its panel shows them hidden; the stealth that hides
  // them stays the hider's (scene/projections/seen.ts)
  unnoticed: (memberId: string) => ReadonlySet<string>
  // the seat's own entropy, seeded, so a fight plays again the same
  rng: () => number
}

export type Box = (input: SeatInput) => Decision

export type Executed = { ok: true; commands: SceneCommand[] } | { ok: false; refused: string }

// The presses a decision comes to on the fight. A press
// must be one of those the seat was offered; a declaration and a settlement
// are pressed as the builders press them (bot/declare.ts), and refused as
// they refuse. Nothing of the fight they were pressed on is handed back, only
// the presses or why not.
export function toCommands(state: SceneState, input: Pick<SeatInput, 'members' | 'buttons' | 'choices'>, decision: Decision, ctx: CommandContext): Executed {
  switch (decision.kind) {
    case 'wait':
      return { ok: true, commands: [] }
    case 'press': {
      const offered = input.buttons.some((b) => b === decision.pick) || input.choices.some((c) => c === decision.pick)
      return offered ? { ok: true, commands: [decision.pick.command] } : { ok: false, refused: `${decision.pick.label} is not among what the seat was offered` }
    }
    case 'declare': {
      if (!input.members.includes(decision.intent.actorId)) return { ok: false, refused: `${decision.intent.actorId} is not the seat's to play` }
      const made = declare(state, decision.intent, ctx)
      return made.ok ? { ok: true, commands: made.commands } : { ok: false, refused: made.refused }
    }
    case 'settle': {
      const actor = getOpenAction(state)?.actorId
      if (!actor || !input.members.includes(actor)) return { ok: false, refused: "the open action is not the seat's to settle" }
      const made = settle(state, decision.picks, ctx, decision.land ?? true)
      return made.ok ? { ok: true, commands: made.commands } : { ok: false, refused: made.refused }
    }
  }
}
