import { apply, diff, type Patch } from '../net/diff'
import type { SceneState } from '../domain/scene/types'
import { getControllerId } from '../domain/scene/rules/domination'
import { isCombatStarted } from '../domain/scene/rules/started'
import { getOwner, type CharacterOwners, type Viewer } from '../domain/profiles'
import type { Dice } from '../domain/play/dice'
import { getBotSeats } from '../domain/bot/bots'
import { forgetFight } from '../domain/bot/forget'
import { getLiveStep, NEW_LIVE, type Live } from '../domain/bot/live'
import { noteSeats, withNoted, type Move } from '../domain/bot/seat'
import type { SeatMemories } from '../domain/bot/memory'

// The bots as a thread of their own plays them (worker.ts): it is told of every
// change to the fight and answers with what they would do next, all of it plain
// data. The screen that keeps the table judges and sends every press
// (client.ts, hooks/useBots.tsx); nothing is played here.

// What the bots go by besides the fight: who plays whom, whether the table
// presses for a GM nobody plays and holds the first round back until told to
// begin, and whether they are paused.
export type BotsTable = { owners: CharacterOwners; auto: boolean; holdStart: boolean; paused: boolean }

// - what is so now, numbered: the fight whole or what changed in it, the table,
//   and what the seats remember, where those are to be taken from here on;
// - the answer numbered `seq` is being pressed, and nothing is decided meanwhile;
// - it is done, and whether its first press was made.
export type ToBots =
  | { kind: 'tell'; seq: number; fight?: SceneState; patch?: Patch; table?: BotsTable; memories?: SeatMemories }
  | { kind: 'taken'; seq: number }
  | { kind: 'done'; seq: number; played: boolean }

// A move with the profile it is pressed as, null for the table's own.
export type SentMove = Pick<Move, 'by' | 'who' | 'why' | 'commands'> & { as: string | null }

export type SentStep = { do: 'nothing' } | { do: 'press'; move: SentMove } | { do: 'stop'; move: SentMove; first: boolean }

// What the bots would do in the fight numbered `seq`, what was refused on the
// way, and what changed in what the seats remember since the last answer taken.
export type BotAnswer = { seq: number; step: SentStep; refused: string[]; memories: Patch | null }

// The entropy a player draws from.
export type Chance = { dice: Dice; rng: () => number; newId: () => string }

const viewerOf = (profile: string, ownerOf: Viewer['ownerOf']): Viewer => ({ profile, role: 'player', gmMode: false, profiles: [], ownerOf })

const sentMove = ({ by, who, why, commands, viewer }: Move): SentMove => ({ by, who, why, commands, as: viewer.profile })

// `think` answers once for each number told, and null where there is nothing
// to answer for.
export function makeBotPlayer(chance: Chance): { hear: (message: ToBots) => void; think: () => BotAnswer | null } {
  let seq = 0
  let fight: SceneState | null = null
  let table: BotsTable | null = null
  let live: Live = NEW_LIVE
  let memories: SeatMemories = {}
  // as the screen has them
  let sent: SeatMemories = {}
  // whether the fight has been noted as it stands
  let noted = true
  let answered: { seq: number; live: Live; move: Move | null; memories: SeatMemories } | null = null
  let pressing = false

  const ownerOf = (id: string) => (fight && table ? getOwner(getControllerId(fight, id), table.owners) : undefined)
  const note = () => {
    if (noted || !fight) return
    memories = noteSeats(memories, fight, getBotSeats(fight, ownerOf))
    noted = true
  }

  const tell = (m: Extract<ToBots, { kind: 'tell' }>) => {
    const before = fight
    seq = m.seq
    if (m.memories) sent = memories = m.memories
    if (m.table) table = m.table
    if (m.fight) fight = m.fight
    if (m.patch && fight) fight = apply(fight, m.patch) as SceneState
    if (fight === before || !fight) return
    if (before && isCombatStarted(before) && !isCombatStarted(fight)) forgetFight()
    noted = false
    // every change to a fight under way is looked at; before it, only where it has come to
    if (isCombatStarted(fight)) note()
  }

  return {
    hear: (m) => {
      if (m.kind === 'tell') return tell(m)
      pressing = m.kind === 'taken'
      if (answered?.seq !== m.seq) return
      if (m.kind === 'taken') {
        live = answered.live
        sent = answered.memories
      } else if (m.played && answered.move) memories = withNoted(memories, answered.move)
    },
    think: () => {
      if (!fight || !table || pressing || answered?.seq === seq) return null
      note()
      const { auto, holdStart, paused } = table
      const seats = getBotSeats(fight, ownerOf)
      const { step, live: next, refused } = seats.length === 0 && !auto
        ? { step: { do: 'nothing' } as const, live, refused: [] }
        : getLiveStep(live, fight, seats, {
          ctx: { thrower: chance.dice, newId: chance.newId },
          botDice: chance.dice,
          rngOf: () => chance.rng,
          autoTable: auto,
          holdStart,
          paused,
          viewerOf: (seat) => viewerOf(seat.profile ?? seat.id, ownerOf),
          memories,
        })
      answered = { seq, live: next, move: step.do === 'nothing' ? null : step.move, memories }
      return { seq, step: step.do === 'nothing' ? step : { ...step, move: sentMove(step.move) }, refused, memories: diff(sent, memories) }
    },
  }
}
