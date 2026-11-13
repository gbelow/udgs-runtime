import type { SceneState } from '../scene/types'
import { applySceneCommand, type CommandContext, type SceneCommand } from '../scene/commands/registry'
import type { Viewer } from '../profiles'
import { rollD10, rollModed, seededRng, type Dice } from '../play/dice'
import { getBelief } from './belief'
import { getMyButtons, getMyChoices, getWaits, type Wait } from './table'
import { toCommands, type Box, type Decision, type SeatInput } from './decision'
import { getTablePress } from './autoTable'

// Bots at the table. A seat is a bot that owns the characters it plays, as a
// player owns theirs: it presses as a player viewer whose profile is the
// seat's, so the table refuses it what it would refuse that player, the GM's
// buttons among them. Each step makes one move and reads the fight again
// before the next, since every press changes it:
//
// 1. a die a bot's character is called to throw is thrown, as bots throw
//    theirs at once (no decision);
// 2. the seats the table waits on are asked, round the table from the seat
//    after the one that last moved (`from`), so no seat is kept waiting by
//    another that always has something to press; the first that decides
//    anything but to wait has its presses sent;
// 3. the table presses what it would (bot/autoTable.ts), when the fight is run
//    without a GM: as a GM does, it moves the round on once nothing owed
//    stands in the way, whatever else the seats might still do;
// 4. every other seat with something open to it is asked, the same way.
//
// What is open to a seat (its buttons, its choices, what the table waits on
// it for) is read off the fight itself, by the panels' own reads (bot/table.ts),
// so that it is the table's answer, then kept to the seat's members: a rule
// run on the fight as the seat sees it would read a foe's hidden sheet as an
// empty one and answer otherwise. What the seat may know of the fight, to
// decide on, is the fight as it sees it (`view`). A decision the seat may not
// make is written down and the seat counts as waiting. When nothing moves, the
// fight is stalled.

export type Seat = { id: string; members: readonly string[]; box: Box }

export function seatViewer(seat: Pick<Seat, 'id' | 'members'>): Viewer {
  return { profile: seat.id, role: 'player', gmMode: false, profiles: [], ownerOf: (id) => (seat.members.includes(id) ? seat.id : undefined) }
}

const GM: Viewer = { profile: null, role: 'gm', gmMode: true, profiles: [], ownerOf: () => undefined }

// One move: who made it, why, the presses sent with the dice each drew, and
// what was refused, if anything was.
export type Entry = { by: string; why: string; sent: { command: SceneCommand; dice: number[] }[]; refused: string | null }

export type StepOptions = {
  ctx: CommandContext
  // what was drawn while a command ran, emptied before each
  drawn: () => number[]
  // the dice a bot throws when a die is called for one of its characters
  botDice: Dice
  rngOf: (seatId: string) => () => number
  // whether the table presses for a GM nobody plays
  autoTable: boolean
}

type Stepped = { state: SceneState; entries: Entry[] }

function send(state: SceneState, commands: readonly SceneCommand[], viewer: Viewer, opts: StepOptions): { state: SceneState; sent: Entry['sent']; refused: string | null } {
  let s = state
  const sent: Entry['sent'] = []
  for (const command of commands) {
    opts.drawn()
    const next = applySceneCommand(s, command, viewer, opts.ctx)
    if (next === s) return { state: s, sent, refused: `${command.kind} was refused by the table` }
    sent.push({ command, dice: [...opts.drawn()] })
    s = next
  }
  return { state: s, sent, refused: null }
}

function present(state: SceneState, seat: Seat): string[] {
  return seat.members.filter((id) => state.characters[id])
}

// What the seat may know and press now, or null when it has nothing at all.
function inputOf(state: SceneState, seat: Seat, members: string[], waits: Wait[], opts: StepOptions): SeatInput | null {
  const buttons = getMyButtons(state, members)
  const choices = getMyChoices(state, members)
  if (waits.length === 0 && buttons.length === 0 && choices.length === 0) return null
  let view: SceneState | null = null
  return {
    members,
    view: () => (view ??= getBelief(state, members, members[0])),
    waits,
    buttons,
    choices,
    rng: opts.rngOf(seat.id),
  }
}

export function step(state: SceneState, seats: readonly Seat[], opts: StepOptions, from = 0): Stepped {
  const entries: Entry[] = []

  for (const call of Object.values(state.calls)) {
    const seat = call.die === null ? seats.find((s) => s.members.includes(call.roller)) : undefined
    if (!seat) continue
    const die = rollModed(call.mode, call.explodes, opts.botDice)
    const made = send(state, [{ kind: 'answer', args: [call.id, die, 'screen'] }], seatViewer(seat), opts)
    entries.push({ by: seat.id, why: `throws ${call.label}`, sent: made.sent, refused: made.refused })
    if (made.state !== state) return { state: made.state, entries }
  }

  const start = seats.length > 0 ? ((from % seats.length) + seats.length) % seats.length : 0
  const round = [...seats.slice(start), ...seats.slice(0, start)]
  const asked = round.map((seat) => {
    const members = present(state, seat)
    return { seat, members, waits: getWaits(state, members) }
  })
  const owed = asked.filter((a) => a.waits.length > 0)
  const moved = askSeats(state, owed, opts, entries)
  if (moved) return { state: moved, entries }

  const press = opts.autoTable ? getTablePress(state) : null
  if (press) {
    const made = send(state, [press], GM, opts)
    entries.push({ by: 'table', why: press.kind, sent: made.sent, refused: made.refused })
    if (made.state !== state) return { state: made.state, entries }
  }

  const rest = askSeats(state, asked.filter((a) => a.waits.length === 0), opts, entries)
  return { state: rest ?? state, entries }
}

// The seats asked in turn; the fight after the first whose presses moved it,
// or null when none did.
function askSeats(state: SceneState, asked: { seat: Seat; members: string[]; waits: Wait[] }[], opts: StepOptions, entries: Entry[]): SceneState | null {
  for (const { seat, members, waits } of asked) {
    if (members.length === 0) continue
    const input = inputOf(state, seat, members, waits, opts)
    if (!input) continue
    const decision: Decision = seat.box(input)
    if (decision.kind === 'wait') continue
    const commands = toCommands(state, input, decision, opts.ctx)
    if (!commands.ok) {
      entries.push({ by: seat.id, why: decision.why, sent: [], refused: commands.refused })
      continue
    }
    const made = send(state, commands.commands, seatViewer(seat), opts)
    entries.push({ by: seat.id, why: decision.why, sent: made.sent, refused: made.refused })
    if (made.state !== state) return made.state
  }
  return null
}

export type RunOptions = { seed: number; autoTable?: boolean; maxSteps?: number; maxRounds?: number }

export type RunEnd = 'ended' | 'stalled' | 'cap'

export type Run = {
  state: SceneState
  end: RunEnd
  // the last round the fight reached
  rounds: number
  // for a stalled fight, what the table still waits on and from whom
  stalled: { seat: string; waits: Wait[] }[]
  log: Entry[]
  // the fight as it began and every press sent with its dice, which the
  // board harness plays again (`replay`)
  record: { table: false; start: SceneState; sent: { command: SceneCommand; dice: number[] }[] }
}

// Plays the fight on with the seats until the combat ends, nothing moves, or
// the cap is reached (a draw). Everything drawn comes from the seed.
export function run(start: SceneState, seats: readonly Seat[], { seed, autoTable = true, maxSteps = 5000, maxRounds = 30 }: RunOptions): Run {
  const tableRng = seededRng(seed)
  const botRng = seededRng(seed ^ 0x5bd1e995)
  const seatRngs = new Map(seats.map((s, i) => [s.id, seededRng(seed + 7919 * (i + 1))]))
  let drawn: number[] = []
  const draw: Dice = (explodes) => {
    const die = rollD10(explodes, tableRng)
    drawn.push(die)
    return die
  }
  let n = 0
  const opts: StepOptions = {
    ctx: { thrower: draw, newId: () => `run-${++n}` },
    drawn: () => {
      const was = drawn
      drawn = []
      return was
    },
    botDice: (explodes) => rollD10(explodes, botRng),
    rngOf: (id) => seatRngs.get(id) ?? botRng,
    autoTable,
  }

  const log: Entry[] = []
  let state = start
  let started = start.round > 0
  let from = 0
  let rounds = start.round
  for (let i = 0; i < maxSteps; i++) {
    if (started && state.round === 0) return finish('ended')
    if (state.round > maxRounds) return finish('cap')
    const moved = step(state, seats, opts, from)
    log.push(...moved.entries)
    const mover = seats.findIndex((s) => s.id === moved.entries.findLast((e) => e.refused === null && e.sent.length > 0)?.by)
    if (mover >= 0) from = mover + 1
    if (moved.state === state) return finish('stalled')
    state = moved.state
    started ||= state.round > 0
    rounds = Math.max(rounds, state.round)
  }
  return finish('cap')

  function finish(end: RunEnd): Run {
    const stalled = end === 'stalled'
      ? seats.map((seat) => ({ seat: seat.id, waits: getWaits(state, present(state, seat)) })).filter((s) => s.waits.length > 0)
      : []
    return { state, end, rounds, stalled, log, record: { table: false, start, sent: log.flatMap((e) => e.sent) } }
  }
}
