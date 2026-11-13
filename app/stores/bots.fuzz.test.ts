import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { openHarness } from './boardHarness'
import { run, type Seat } from '../domain/bot/seat'
import type { Box } from '../domain/bot/decision'
import type { SceneCommand } from '../domain/scene/commands/registry'
import type { SceneState } from '../domain/scene/types'
import { hasAgreedToEnd } from '../domain/scene/rules/turn'
import { archer, brawler, spearman, warden } from '../domain/scene/fixtures'
import type { CampaignCharacter } from '../domain/types'

// Bots on every side of a fight with nobody as GM: each seat presses anything
// open to it at random (`randomBox`) and the table presses for the GM
// (bot/autoTable.ts). What the architecture promises of it: every decision made
// from what is open is taken by the table, and the fight never stalls, so it
// ends or reaches the cap. A failure writes the record to
// reports/bots-replay-seed-N.json.

// A box that presses anything open to its seat, a button or a fill, at random
// from its seat's own entropy. It decides nothing worth keeping: it is what
// drives the seat loop here. It picks a kind of press first, then one of that
// kind, so that a hundred cells or answers do not crowd out the one button that
// moves the fight on; and it takes nothing back (an answer, a declaration, its
// agreement to end the round, its contest) while anything else is open, so that
// the fight goes on.
const randomBox: Box = ({ buttons, choices, rng, view }) => {
  const open = [...buttons, ...choices.filter((c) => !c.chosen)]
  if (open.length === 0) return { kind: 'wait', why: 'nothing open' }
  const forward = open.filter((o) => !isUndo(view(), o.command))
  const from = forward.length > 0 ? forward : open
  const kinds = [...new Set(from.map((o) => o.command.kind))]
  const kind = kinds[Math.floor(rng() * kinds.length)]
  const ofKind = from.filter((o) => o.command.kind === kind)
  const pick = ofKind[Math.floor(rng() * ofKind.length)]
  return { kind: 'press', pick, why: pick.label }
}

function isUndo(state: SceneState, command: SceneCommand): boolean {
  switch (command.kind) {
    case 'back':
    case 'cancel':
    case 'skip':
    case 'refund':
    case 'unimprove':
      return true
    case 'toggleAgreeToEnd':
      return hasAgreedToEnd(state, command.args[0])
    case 'toggleContest':
      return state.contenders.includes(command.args[0])
    default:
      return false
  }
}

const SEEDS = Array.from({ length: Number(process.env.FUZZ_SEEDS ?? 4) }, (_, i) => i + 1)

type Side = { seat: string; fighters: [string, (name: string) => CampaignCharacter, [number, number]][] }

const SIDES: Side[] = [
  { seat: 'red', fighters: [['Ann', spearman, [0, 0]], ['Bob', archer, [0, 1]]] },
  { seat: 'blue', fighters: [['Cy', brawler, [3, 0]], ['Dee', warden, [3, -1]]] },
]

function setUp() {
  const h = openHarness()
  h.bring(...SIDES.flatMap((side) => side.fighters.map(([name, make]) => make(name))))
  h.createBoard(5)
  for (const [name, , [q, r]] of SIDES.flatMap((side) => side.fighters)) {
    h.select(name)
    h.cell(q, r)
  }
  // each side one party of the fight
  for (const side of SIDES) {
    const [lead, ...rest] = side.fighters.map(([name]) => h.idOf(name))
    const others = SIDES.filter((s) => s !== side).flatMap((s) => s.fighters.map(([name]) => h.state().partyOf[h.idOf(name)]))
    if (others.includes(h.state().partyOf[lead])) {
      const before = Object.keys(h.state().parties)
      h.send({ kind: 'createParty', args: [side.seat] })
      const made = Object.keys(h.state().parties).find((id) => !before.includes(id))!
      h.send({ kind: 'moveToParty', args: [lead, made] })
    }
    for (const id of rest) h.send({ kind: 'moveToParty', args: [id, h.state().partyOf[lead]] })
  }
  const seats: Seat[] = SIDES.map((side) => ({ id: side.seat, members: side.fighters.map(([name]) => h.idOf(name)), box: randomBox }))
  return { start: h.state(), seats }
}

describe('bots play a fight with nobody as GM', () => {
  it.each(SEEDS)('takes every decision made from what is open and never stalls (seed %i)', (seed) => {
    const { start, seats } = setUp()
    expect(new Set(Object.values(start.partyOf)).size, 'the fight has two sides').toBe(2)
    const played = run(start, seats, { seed, maxRounds: 4 })
    const refused = played.log.filter((e) => e.refused).map((e) => `${e.by}: ${e.why}: ${e.refused}`)
    if (refused.length > 0 || played.end === 'stalled') {
      mkdirSync('reports', { recursive: true })
      writeFileSync(`reports/bots-replay-seed-${seed}.json`, JSON.stringify(played.record))
    }
    expect(refused, 'decisions refused').toEqual([])
    expect(played.end, `stalled, waiting on ${JSON.stringify(played.stalled)}`).not.toBe('stalled')
  })
})
