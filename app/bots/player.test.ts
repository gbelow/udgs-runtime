import { describe, expect, it } from 'vitest'
import type { SceneState } from '../domain/scene/types'
import { applySceneCommand, type CommandContext } from '../domain/scene/commands/registry'
import { board, spearman } from '../domain/scene/fixtures'
import { rollD10, seededRng } from '../domain/play/dice'
import { getOwner } from '../domain/profiles'
import { getControllerId } from '../domain/scene/rules/domination'
import { getBotSeats } from '../domain/bot/bots'
import { getLiveStep, NEW_LIVE } from '../domain/bot/live'
import { SeatMemoriesSchema, type SeatMemories } from '../domain/bot/memory'
import { noteSeats, seatViewer, TABLE, withNoted } from '../domain/bot/seat'
import { apply, diff } from '../net/diff'
import { makeBotPlayer, type BotAnswer, type BotsTable, type ToBots } from './player'

const CHANCE = { dice: () => 5, rng: () => 0.5, newId: () => 'x' }
const OWNERS = { a: 'bot:spec', b: 'bot:spec' }
const STEPS = 12

const start: SceneState = {
  ...board({ a: [0, 0], b: [7, 0] }, spearman('a'), spearman('b')),
  parties: { ours: { name: 'ours', from: '' }, theirs: { name: 'theirs', from: '' } },
  partyOf: { a: 'ours', b: 'theirs' },
}

function bout() {
  const rng = seededRng(1)
  let n = 0
  const ctx: CommandContext = { thrower: (e) => rollD10(e, rng), newId: () => `t${++n}` }
  let state = start
  return {
    state: () => state,
    press: (answer: BotAnswer) => {
      if (answer.step.do !== 'press') return
      const { move } = answer.step
      const viewer = move.as === null ? TABLE : seatViewer(getBotSeats(state, (id) => getOwner(id, OWNERS)).find((s) => s.id === move.by)!)
      for (const command of move.commands) state = applySceneCommand(state, command, viewer, ctx)
    },
  }
}

// What a thread is sent is copied on the way, so nothing in it is an object of
// the sender's, and what comes back is copied too.
function thread() {
  const player = makeBotPlayer(CHANCE)
  let told: SceneState | null = null
  let seq = 0
  const hear = (message: ToBots) => player.hear(structuredClone(message))
  return {
    hear,
    seq: () => seq,
    tell: (fight: SceneState, table?: BotsTable) => {
      hear({ kind: 'tell', seq: ++seq, ...(told ? { patch: diff(told, fight) ?? undefined } : { fight }), ...(table ? { table } : {}) })
      told = fight
    },
    think: () => structuredClone(player.think()),
  }
}

const TABLE_OF: BotsTable = { owners: OWNERS, auto: true, holdStart: false, paused: false }

// The moves the bots make on the screen's own thread, as `run` would play them.
function playedHere(): { moves: string[]; memories: SeatMemories } {
  const b = bout()
  const moves: string[] = []
  let live = NEW_LIVE
  let memories: SeatMemories = {}
  let seen: SeatMemories = {}
  for (let i = 0; i < STEPS; i++) {
    const state = b.state()
    const ownerOf = (id: string) => getOwner(getControllerId(state, id), OWNERS)
    const seats = getBotSeats(state, ownerOf)
    seen = memories = noteSeats(memories, state, seats)
    const asked = getLiveStep(live, state, seats, { ctx: { thrower: CHANCE.dice, newId: CHANCE.newId }, botDice: CHANCE.dice, rngOf: () => CHANCE.rng, autoTable: true, memories })
    live = asked.live
    if (asked.step.do !== 'press') break
    const { move } = asked.step
    moves.push(JSON.stringify([move.by, move.why, move.commands]))
    b.press({ seq: i, step: { do: 'press', move: { ...move, as: move.viewer.profile } }, refused: [], memories: null })
    memories = withNoted(memories, move)
  }
  return { moves, memories: seen }
}

// `late`: an answer for every fight is dropped, the fight told again meanwhile.
function playedByThread(late: boolean): { moves: string[]; memories: SeatMemories } {
  const b = bout()
  const t = thread()
  const moves: string[] = []
  let memories: SeatMemories = {}
  for (let i = 0; i < STEPS; i++) {
    t.tell(b.state(), TABLE_OF)
    let answer = t.think()
    if (late) {
      t.tell(b.state(), TABLE_OF)
      answer = t.think()
    }
    if (!answer) throw new Error('not answered')
    if (answer.memories) memories = apply(memories, answer.memories) as SeatMemories
    if (answer.step.do !== 'press') break
    const { by, why, commands } = answer.step.move
    moves.push(JSON.stringify([by, why, commands]))
    t.hear({ kind: 'taken', seq: t.seq() })
    const answered = t.seq()
    b.press(answer)
    t.tell(b.state())
    t.hear({ kind: 'done', seq: answered, played: true })
  }
  return { moves, memories }
}

describe('the bots on a thread of their own', () => {
  const here = playedHere()

  it('make the moves they would make on the screen that plays them', () => {
    expect(here.moves.length).toBeGreaterThan(5)
    expect(playedByThread(false)).toEqual(here)
  })

  it('make them where every first answer came too late', () => {
    expect(playedByThread(true)).toEqual(here)
  })

  it('answer a fight once, and nothing while an answer is being pressed', () => {
    const t = thread()
    t.tell(start, TABLE_OF)
    expect(t.think()).not.toBeNull()
    expect(t.think()).toBeNull()
    t.hear({ kind: 'taken', seq: t.seq() })
    t.tell(start, { ...TABLE_OF, paused: true })
    expect(t.think()).toBeNull()
    t.hear({ kind: 'done', seq: t.seq() - 1, played: false })
    expect(t.think()).not.toBeNull()
  })

  it('remember what a browser keeps and reads back unchanged', () => {
    const { memories } = playedByThread(false)
    const read = SeatMemoriesSchema.parse(structuredClone(memories))
    expect(Object.keys(read).length).toBeGreaterThan(0)
    expect(read).toEqual(memories)
    expect(SeatMemoriesSchema.parse(read)).toEqual(read)
  })
})
