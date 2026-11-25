import type { SceneState } from '../scene/types'
import { applySceneCommand, type CommandContext, type SceneCommand } from '../scene/commands/registry'
import { getContestClosed, getRollContestBar, getTurnHolder } from '../scene/rules/turn'
import { getOpenAction } from '../scene/rules/log'
import { isContestPending } from '../scene/rules/contest'
import { notices } from '../scene/rules/stealth'
import type { Viewer } from '../profiles'
import { rollD10, rollModed, seededRng, type Dice } from '../play/dice'
import { getBelief } from './belief'
import { getMyButtons, getMyChoices, getWaits, type Wait } from './table'
import { toCommands, type Box, type Decision, type Pass, type SeatInput } from './decision'
import { getTablePress } from './autoTable'
import { remember, withRemembered, type Notes, type SeatMemories, type SeatMemory } from './memory'

// Bots at the table. A seat is a bot that owns the characters it plays, as a
// player owns theirs: it presses as a player viewer whose profile is the
// seat's, so the table refuses it what it would refuse that player, the GM's
// buttons among them. Each step makes one move and reads the fight again
// before the next, since every press changes it:
//
// 1. a die a bot's character is called to throw is thrown, as bots throw
//    theirs at once (no decision);
// 2. while a turn just taken may still be contested (combat.tex "Turn
//    order"), every seat but the holder's is asked first for what it wants
//    to do now, so that it may contest the turn before the holder plays it;
//    then, at a fight run without a GM, the contest is rolled;
// 3. the seats the table waits on are asked, round the table from the seat
//    after the one that last moved (`from`), so no seat is kept waiting by
//    another that always has something to press; the first that decides
//    anything but to wait has its presses sent;
// 4. the table presses what it would (bot/autoTable.ts), when the fight is run
//    without a GM: as a GM does, it moves the round on once nothing owed
//    stands in the way, whatever else the seats might still do;
// 5. every other seat with something open to it is asked, the same way:
//    first for what it wants to do now, and only once none does, for
//    anything (the user's ruling: a turn to better a position is asked for
//    only when nobody wants one to act now).
//
// Paused, the seats decide nothing: only the dice are thrown (1), the contest
// rolled (2), and what the table presses pressed (4), once no seat owes
// anything.
//
// What is open to a seat (its buttons, its choices, what the table waits on
// it for) is read off the fight itself, by the panels' own reads (bot/table.ts),
// so that it is the table's answer, then kept to the seat's members: a rule
// run on the fight as the seat sees it would read a foe's hidden sheet as an
// empty one and answer otherwise. What the seat may know of the fight, to
// decide on, is the fight as it sees it (`view`). A decision the seat may not
// make is written down and the seat counts as waiting. When nothing moves, the
// fight is stalled.

// A seat presses as `profile`, or as its id when it has none: a bot that
// plays several parties plays each as a seat of its own, under one profile.
export type Seat = { id: string; members: readonly string[]; box: Box; profile?: string }

export function seatViewer(seat: Pick<Seat, 'id' | 'members' | 'profile'>): Viewer {
  const profile = seat.profile ?? seat.id
  return { profile, role: 'player', gmMode: false, profiles: [], ownerOf: (id) => (seat.members.includes(id) ? profile : undefined) }
}

const GM: Viewer = { profile: null, role: 'gm', gmMode: true, profiles: [], ownerOf: () => undefined }

// One move: who made it, why, the presses sent with the dice each drew, and
// what was refused, if anything was.
export type Entry = { by: string; why: string; sent: { command: SceneCommand; dice: number[] }[]; refused: string | null }

export type MoveOptions = {
  ctx: CommandContext
  // the dice a bot throws when a die is called for one of its characters
  botDice: Dice
  rngOf: (seatId: string) => () => number
  // whether the table presses for a GM nobody plays, and whether it holds
  // the first round back until it is told to begin (`getTablePress`)
  autoTable: boolean
  holdStart?: boolean
  // whether the seats decide nothing: what they owe is left to wait, and only
  // the dice called for and what the table presses go on
  paused?: boolean
  // whom a seat presses as: its own player viewer when not given
  viewerOf?: (seat: Seat) => Viewer
  // what each seat remembers of the foes it noticed, and its box's notes, by seat id (`noteSeats`, `withNoted`)
  memories?: SeatMemories
}

// Every seat's memory once it has looked at the fight as it stands
// (bot/memory.ts `remember`), and its box's notes from that look, for
// whoever runs the seats to keep between moves.
export function noteSeats(memories: SeatMemories, state: SceneState, seats: readonly Seat[]): SeatMemories {
  return Object.fromEntries(seats.flatMap((seat) => {
    const { remembers, notes } = seat.box
    if (!remembers && !notes) return []
    const was = memories[seat.id]
    const foes = remembers ? remember(was?.foes, state, seat.members) : {}
    const members = present(state, seat)
    const noted = notes && members.length ? notes(was?.notes, withRemembered(getBelief(state, members, members[0]), foes), members) : {}
    return [[seat.id, { foes, notes: noted }]]
  }))
}

// What the seats remember once a move has been played: its seat's notes with
// those its box made of it (decision.ts `noted`), for whoever plays it to keep.
export function withNoted(memories: SeatMemories, move: Pick<Move, 'by' | 'noted'>): SeatMemories {
  if (!move.noted) return memories
  const was = memories[move.by]
  return { ...memories, [move.by]: { foes: was?.foes ?? {}, notes: { ...was?.notes, ...move.noted } } }
}

export type StepOptions = MoveOptions & {
  // what was drawn while a command ran, emptied before each
  drawn: () => number[]
}

// What a seat, or the table, would press, as whom, and for which of its
// characters (`who`, none for the table's); or a decision of a seat that came
// to no presses it may make. `noted`: what its box notes once it is played (`withNoted`).
export type Move = { by: string; who: string | null; why: string; viewer: Viewer; commands: readonly SceneCommand[]; noted?: Notes }
type Candidate = Move | { by: string; who: string | null; why: string; refused: string }

// The character a decision is for: the one it declares or answers with, the
// one whose action it lands, or the one the button or choice it presses is for.
function whoDecided(state: SceneState, members: readonly string[], decision: Decision): string | null {
  switch (decision.kind) {
    case 'declare':
      return decision.intent.actorId
    case 'declareOpened':
    case 'settle':
      return getOpenAction(state)?.actorId ?? null
    case 'press': {
      if ('actorId' in decision.pick) return decision.pick.actorId
      const first = (decision.pick.command.args as readonly unknown[])[0]
      return typeof first === 'string' && members.includes(first) ? first : null
    }
    case 'wait':
      return null
  }
}

type Stepped = { state: SceneState; entries: Entry[]; memories: SeatMemories }

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

// What a seat sees of one state of the fight, read once however often it is
// asked on that state, so that every pass of a step hands its box the same
// view.
type Seen = { view: SceneState | null; unnoticed: Map<string, ReadonlySet<string>> }

const seenKept = new WeakMap<SceneState, Map<string, Seen>>()

function seenBy(state: SceneState, members: readonly string[], memory: SeatMemory | undefined): Seen {
  const bySeat = seenKept.get(state) ?? new Map<string, Seen>()
  seenKept.set(state, bySeat)
  const key = `${members.join(',')}|${Object.entries(memory ?? {}).map(([id, m]) => `${id}@${m.round}${m.placement ? '' : '?'}`).join(',')}`
  let seen = bySeat.get(key)
  if (!seen) bySeat.set(key, (seen = { view: null, unnoticed: new Map() }))
  return seen
}

// What the seat may know and press now, or null when it has nothing at all.
function inputOf(state: SceneState, seat: Seat, members: string[], waits: Wait[], pass: Pass, opts: MoveOptions): SeatInput | null {
  const buttons = getMyButtons(state, members)
  const choices = getMyChoices(state, members)
  if (waits.length === 0 && buttons.length === 0 && choices.length === 0) return null
  const memory = seat.box.remembers ? opts.memories?.[seat.id]?.foes : undefined
  const seen = seenBy(state, members, memory)
  // a turn is weighed as it is once nobody contests it: what a seat tries on
  // its view is never held up by the time to
  const read = () => (seen.view ??= { ...withRemembered(getBelief(state, members, members[0]), memory), contestSeconds: 0 })
  const unnoticed = seen.unnoticed
  return {
    members,
    view: read,
    waits,
    buttons,
    choices,
    unnoticed: (memberId) => {
      let hidden = unnoticed.get(memberId)
      if (!hidden) unnoticed.set(memberId, (hidden = new Set(Object.keys(read().characters).filter((id) => id !== memberId && !notices(state, memberId, id)))))
      return hidden
    },
    rng: opts.rngOf(seat.id),
    pass,
    notes: opts.memories?.[seat.id]?.notes ?? {},
  }
}

// The moves in the order they are tried, each decided only when reached.
function* getMoves(state: SceneState, seats: readonly Seat[], opts: MoveOptions, from: number): Generator<Candidate> {
  const viewerOf = opts.viewerOf ?? seatViewer
  for (const call of Object.values(state.calls)) {
    const seat = call.die === null ? seats.find((s) => s.members.includes(call.roller)) : undefined
    if (!seat) continue
    const die = rollModed(call.mode, call.explodes, opts.botDice)
    yield { by: seat.id, who: call.roller, why: `throws ${call.label}`, viewer: viewerOf(seat), commands: [{ kind: 'answer', args: [call.id, die, 'screen'] }] }
  }

  const start = seats.length > 0 ? ((from % seats.length) + seats.length) % seats.length : 0
  const round = [...seats.slice(start), ...seats.slice(0, start)]
  const asked = round.map((seat) => {
    const members = present(state, seat)
    return { seat, members, waits: getWaits(state, members) }
  })
  const holder = getTurnHolder(state)
  const players = Object.keys(state.characters).filter((id) => !seats.some((s) => s.members.includes(id)))
  if (holder && getContestClosed(state) === null) {
    if (!opts.paused) yield* askSeats(state, asked.filter((a) => !a.members.includes(holder)), 'immediate', opts)
    if (opts.autoTable && !isContestPending(state) && getRollContestBar(state) === null) yield { by: 'table', who: null, why: 'rollContest', viewer: GM, commands: [{ kind: 'rollContest', args: [] }] }
  }
  // the time to contest is closed by whoever keeps the table's clock, unless
  // only bots are at it, who have all been asked
  if (isContestPending(state)) {
    if (opts.autoTable && players.length === 0) yield { by: 'table', who: null, why: 'closeContest', viewer: GM, commands: [{ kind: 'closeContest', args: [] }] }
    return
  }
  const owing = asked.filter((a) => a.waits.length > 0)
  if (opts.paused && owing.length > 0) return
  yield* askSeats(state, owing, 'any', opts)

  const press = opts.autoTable ? getTablePress(state, players, opts.holdStart) : null
  if (press) yield { by: 'table', who: null, why: press.kind, viewer: GM, commands: [press] }

  if (opts.paused) return
  const idle = asked.filter((a) => a.waits.length === 0)
  yield* askSeats(state, idle, 'immediate', opts)
  yield* askSeats(state, idle, 'any', opts)
}

// What a seat may do on the pass that asks only what it wants to do now: ask
// for a turn, or contest one. Anything else it decides there is taken as
// waiting, and asked of it again on the pass that asks for anything.
const ASKING = new Set<SceneCommand['kind']>(['startTurn', 'toggleContest'])
const asksForTurn = (decision: Decision): boolean => decision.kind === 'press' && ASKING.has(decision.pick.command.kind)

// The seats asked in turn, each for its decision as presses.
function* askSeats(state: SceneState, asked: { seat: Seat; members: string[]; waits: Wait[] }[], pass: Pass, opts: MoveOptions): Generator<Candidate> {
  const viewerOf = opts.viewerOf ?? seatViewer
  for (const { seat, members, waits } of asked) {
    if (members.length === 0) continue
    const input = inputOf(state, seat, members, waits, pass, opts)
    if (!input) continue
    const decision: Decision = seat.box(input)
    if (decision.kind === 'wait' || (pass === 'immediate' && !asksForTurn(decision))) continue
    const commands = toCommands(state, input, decision, opts.ctx)
    const who = whoDecided(state, members, decision)
    yield commands.ok
      ? { by: seat.id, who, why: decision.why, viewer: viewerOf(seat), commands: commands.commands, noted: decision.noted }
      : { by: seat.id, who, why: decision.why, refused: commands.refused }
  }
}

export function step(state: SceneState, seats: readonly Seat[], opts: StepOptions, from = 0): Stepped {
  const entries: Entry[] = []
  const memories = opts.memories ?? {}
  for (const move of getMoves(state, seats, opts, from)) {
    if ('refused' in move) {
      entries.push({ by: move.by, why: move.why, sent: [], refused: move.refused })
      continue
    }
    const made = send(state, move.commands, move.viewer, opts)
    entries.push({ by: move.by, why: move.why, sent: made.sent, refused: made.refused })
    if (made.state !== state) return { state: made.state, entries, memories: withNoted(memories, move) }
  }
  return { state, entries, memories }
}

// The move `step` would make, found on a trial of the fight instead of made,
// for a table that sends it itself; with what was refused on the way. The
// next call takes `from` as the seat after the one that moved (`next`), so
// that no seat is kept waiting by another that always has something to press.
export function getNextMove(state: SceneState, seats: readonly Seat[], opts: MoveOptions, from = 0): { move: Move | null; next: number; refused: string[] } {
  const refused: string[] = []
  for (const move of getMoves(state, seats, opts, from)) {
    if ('refused' in move) {
      refused.push(`${move.by}: ${move.why}: ${move.refused}`)
      continue
    }
    let s = state
    for (const command of move.commands) {
      const next = applySceneCommand(s, command, move.viewer, opts.ctx)
      if (next === s) break
      s = next
    }
    const mover = seats.findIndex((seat) => seat.id === move.by)
    if (s !== state) return { move, next: mover >= 0 ? mover + 1 : from, refused }
    refused.push(`${move.by}: ${move.why}: refused by the table`)
  }
  return { move: null, next: from, refused }
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
    opts.memories = noteSeats(opts.memories ?? {}, state, seats)
    const moved = step(state, seats, opts, from)
    opts.memories = moved.memories
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
