import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { openHarness } from '../app/stores/boardHarness'
import { useCombatStore } from '../app/stores/useCombatStore'
import { makeBoardMap } from '../app/domain/scene/factories'
import { SceneStateSchema, type SceneState, type RootAction } from '../app/domain/scene/types'
import { toUpdater, type SceneCommand } from '../app/domain/scene/commands/registry'
import { getOpenAction } from '../app/domain/scene/rules/log'
import { getAvailableActions, getAwaited } from '../app/domain/scene/rules/options'
import { getReachableCells } from '../app/domain/scene/rules/board/reach'
import { getTargetIds } from '../app/domain/scene/rules/action'
import { getFreeAttackOptions, hasUnfocusedRow } from '../app/domain/scene/rules/attack'
import { isCombatStarted } from '../app/domain/scene/rules/started'
import { getSettled } from '../app/domain/scene/rules/settle'
import { getOutcomes } from '../app/domain/scene/projections/outcomes'
import { getSceneSeenBy } from '../app/domain/scene/projections/seen'
import { getBelief } from '../app/domain/bot/belief'
import { getMyButtons } from '../app/domain/bot/table'
import { getOpenButtons } from '../app/domain/scene/projections/buttons'
import { getReach } from '../app/domain/bot/reach'
import { declare, type Intent } from '../app/domain/bot/declare'
import { bestSpend, predict } from '../app/domain/bot/predict'
import { MOVEMENT_KINDS } from '../app/domain/lists'
import { passRound } from '../app/domain/scene/fixtures'

// How long each thing a bot would ask of the fight takes to answer, on a
// catalog battle map with catalog fighters, set up as a table sets one up:
// fighters brought in from the sidebar, the map loaded from the picker, each
// placed by a click, two parties made, the first round begun as the GM's next
// round begins it, and a turn started. Each question is
// asked cold (on a copy of the fight that shares no object with the one any
// cache has seen) and warm (asked again of the same fight). Besides what it
// reads, what it presses: a strike and a move declared whole by the builder
// (bot/declare.ts), and a hit predicted with what its overflow buys
// (bot/predict.ts), and its overflow spent on damage (`bestSpend`).
//
//   pnpm bench [--cold n] [--warm n] [--only text]
//
// `--only` asks only the questions whose name holds the text, for profiling one.
//
// The report goes to reports/bench-sense.md.

const ARENA = 'Arena 1'
const COMMON = ['Erthal Soldier', 'Halkir squire', 'Human Noble', 'Surbit Thief']

type Scenario = { name: string; red: [string, [number, number]][]; blue: [string, [number, number]][] }

const side = (cells: [number, number][]): [string, [number, number]][] => COMMON.map((who, i) => [who, cells[i]])

// The north of the arena is open grass; the middle has a house with walls on
// the west and a walled square on the east, so the last scenario's sides
// stand partly out of each other's sight.
const SCENARIOS: Scenario[] = [
  { name: 'duel, engaged', red: [['Erthal Soldier', [0, -8]]], blue: [['Surbit Thief', [1, -8]]] },
  { name: 'duel, apart', red: [['Erthal Soldier', [-6, -8]]], blue: [['Surbit Thief', [6, -8]]] },
  { name: 'four a side, open', red: side([[-5, -9], [-5, -8], [-5, -7], [-6, -7]]), blue: side([[5, -9], [5, -8], [5, -7], [6, -8]]) },
  { name: 'four a side, houses', red: side([[-6, -2], [-6, 0], [-6, 2], [-7, 1]]), blue: side([[6, -2], [6, 0], [6, 2], [7, -1]]) },
]

function flag(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? Number(process.argv[at + 1]) : fallback
}

const COLD = flag('cold', 20)
const WARM = flag('warm', 200)
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null

const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(process.cwd(), file), 'utf-8'))

// The fight as the table leaves it once everyone is placed and the first round
// has begun: no turn taken yet.
function setUp(scenario: Scenario): { state: SceneState; red: string[]; blue: string[] } {
  const h = openHarness(() => 5)
  const ids = (who: [string, [number, number]][]) => who.map(([name, cell]) => {
    const before = new Set(Object.keys(h.state().characters))
    h.bring(readJson(`app/assets/characters/${name}.json`) as never)
    const id = Object.keys(h.state().characters).find((k) => !before.has(k))
    if (!id) throw new Error(`${name} was not brought in`)
    return { id, cell }
  })
  const red = ids(scenario.red)
  const blue = ids(scenario.blue)
  h.loadMap(makeBoardMap({ ...(readJson(`app/assets/boards/${ARENA}.json`) as object), name: ARENA }))
  for (const { id, cell } of [...red, ...blue]) {
    useCombatStore.getState().setActiveCharacter(id)
    h.cell(...cell)
    const at = h.state().board?.placements[id]?.cell
    if (!at || at.q !== cell[0] || at.r !== cell[1]) throw new Error(`${scenario.name}: could not place ${id} at ${cell}`)
  }
  for (const [side, members] of [['Red', red], ['Blue', blue]] as const) {
    const before = new Set(Object.keys(h.state().parties))
    h.send({ kind: 'createParty', args: [side] })
    const partyId = Object.keys(h.state().parties).find((k) => !before.has(k))!
    for (const { id } of members) h.send({ kind: 'moveToParty', args: [id, partyId] })
  }
  const started = passRound(() => 5)(SceneStateSchema.parse(h.state()))
  return { state: started, red: red.map((m) => m.id), blue: blue.map((m) => m.id) }
}

let n = 0
const newId = () => `bench${++n}`
const ctx = { thrower: () => 5, newId }
const press = (state: SceneState, ...commands: SceneCommand[]): SceneState =>
  commands.reduce((s, command) => toUpdater(command, ctx)(s), state)

type Timing = { scenario: string; question: string; calls: number; cold: number[]; moved: number[]; warm: number }
const timings: Timing[] = []

// `ask` on `state` cold, COLD times on fresh copies; after a move, COLD times
// on a copy as the fight is after someone else's walk (a new state and new
// placements, the ground and every sheet the same objects); and warm, WARM
// times on one copy already asked once.
function measure(scenario: string, question: string, state: SceneState, ask: (s: SceneState) => unknown): void {
  if (ONLY && !question.includes(ONLY)) return
  const cold: number[] = []
  for (let i = 0; i < COLD; i++) {
    const copy = structuredClone(state)
    const t0 = performance.now()
    ask(copy)
    cold.push(performance.now() - t0)
  }
  const fresh = structuredClone(state)
  ask(fresh)
  const moved: number[] = []
  for (let i = 0; i < COLD; i++) {
    const after = { ...fresh, board: fresh.board && { ...fresh.board, placements: { ...fresh.board.placements } } }
    const t0 = performance.now()
    ask(after)
    moved.push(performance.now() - t0)
  }
  const copy = structuredClone(state)
  ask(copy)
  const t0 = performance.now()
  for (let i = 0; i < WARM; i++) ask(copy)
  const warm = (performance.now() - t0) / WARM
  const known = timings.find((t) => t.scenario === scenario && t.question === question)
  if (known) {
    known.calls++
    known.cold.push(...cold)
    known.moved.push(...moved)
    known.warm += warm
  } else timings.push({ scenario, question, calls: 1, cold, moved, warm })
}

// `ask` on `state` itself, COLD times, for what is only fast on the very state
// an earlier answer was read in (a move declared on the state its reach was
// read in); shown as cold, with no after-a-move column.
function measureOn(scenario: string, question: string, state: SceneState, ask: (s: SceneState) => unknown): void {
  if (ONLY && !question.includes(ONLY)) return
  const cold: number[] = []
  for (let i = 0; i < COLD; i++) {
    const t0 = performance.now()
    ask(state)
    cold.push(performance.now() - t0)
  }
  const known = timings.find((t) => t.scenario === scenario && t.question === question)
  const warm = mean(cold)
  if (known) {
    known.calls++
    known.cold.push(...cold)
    known.warm += warm
  } else timings.push({ scenario, question, calls: 1, cold, moved: [], warm })
}

function needsFocus(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return getFreeAttackOptions(state, c, 'shoot').length === 0 && hasUnfocusedRow(c, 'shoot', isCombatStarted(state))
}

// Cells some movement reaches, with the movement surge made or not, that the
// reach does not: a check of the ruling that the fastest movement reaches all.
const missed: { scenario: string; id: string; movement: string; reach: number; missed: string[] }[] = []

function missedBy(scenario: string, turn: SceneState, id: string): void {
  const reach = getReach(turn, id)
  const covered = new Set((reach?.cells ?? []).map((r) => `${r.cell.q},${r.cell.r}`))
  const surged = press(turn, { kind: 'surge', args: [id, 'movement'] })
  const lost = new Set<string>()
  for (const from of [turn, surged]) {
    for (const movement of MOVEMENT_KINDS) {
      const moving = press(from, { kind: 'declare', args: [id, { kind: 'move' }] }, { kind: 'amend', args: [{ movement }] })
      const open = getOpenAction(moving)
      if (open?.kind !== 'move' || open.movement !== movement) continue
      for (const r of getReachableCells(moving, open)) {
        const key = `${r.cell.q},${r.cell.r}`
        if (!covered.has(key)) lost.add(`${key} by ${movement}`)
      }
    }
  }
  missed.push({ scenario, id: turn.names?.[id] ?? id, movement: `${reach?.movement ?? 'none'}${reach?.surged ? ', surged' : ''}`, reach: covered.size, missed: [...lost] })
}

function benchCharacter(scenario: string, setUpState: SceneState, id: string, side: string[], foes: string[]): void {
  const turn = press(setUpState, { kind: 'startTurn', args: [id] })
  if (turn === setUpState) throw new Error(`${scenario}: ${id} could not start a turn`)

  measure(scenario, 'view (getSceneSeenBy)', turn, (s) => getSceneSeenBy(s, new Set(side)))
  measure(scenario, 'view + faces (getBelief)', turn, (s) => getBelief(s, side, id))
  measure(scenario, 'action options (getAvailableActions)', turn, (s) => getAvailableActions(s, id))
  measure(scenario, 'ping (getOpenAction + getAwaited)', turn, (s) => [getOpenAction(s), getAwaited(s)])
  measure(scenario, 'buttons of the whole table (getOpenButtons)', turn, (s) => getOpenButtons(s))
  measure(scenario, 'buttons of one seat (getMyButtons)', turn, (s) => getMyButtons(s, [id]))

  measure(scenario, 'reach (getReach: fastest movement, surged)', turn, (s) => getReach(s, id))
  const reach = getReach(turn, id)
  if (reach?.cells.length) {
    const far = reach.cells.reduce((a, b) => (b.steps > a.steps ? b : a))
    const move: Intent = { actorId: id, option: { kind: 'move' }, picks: [{ part: 'movement', value: reach.movement }, { part: 'cell', value: far.cell }] }
    // on a copy the reach is walked again; on the state it was read in, the
    // builder finds it walked
    measure(scenario, 'declare a move (builder: movement, farthest cell, commit)', reach.from, (s) => declare(s, move, ctx))
    measureOn(scenario, 'declare a move on the state its reach was read in', reach.from, (s) => declare(s, move, ctx))
  }
  if (!ONLY) missedBy(scenario, turn, id)

  let previewed = false
  for (const kind of ['strike', 'shoot'] as const) {
    const ready = kind === 'shoot' && needsFocus(turn, id) ? press(turn, { kind: 'surge', args: [id, 'focus'] }) : turn
    measure(scenario, `${kind} rows (getFreeAttackOptions)`, ready, (s) => getFreeAttackOptions(s, s.characters[id], kind))
    for (const row of getFreeAttackOptions(ready, ready.characters[id], kind)) {
      const aimed = press(ready, { kind: 'declare', args: [id, { kind }] }, { kind: 'amend', args: [{ weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }] })
      const open = getOpenAction(aimed)
      if (open?.kind !== kind) continue
      measure(scenario, `${kind} targets per row (getTargetIds)`, aimed, (s) => getTargetIds(s, getOpenAction(s) as RootAction))
      const target = getTargetIds(aimed, open).find((t) => foes.includes(t))
      if (previewed || !target) continue
      const committed = press(aimed, { kind: 'target', args: [target] }, { kind: 'commit', args: [] })
      const waiting = getOpenAction(committed)
      if (waiting?.step !== 'react') continue
      previewed = true
      measure(scenario, 'outcome preview (getSettled + getOutcomes)', committed, (s) => {
        const at = getOpenAction(s) as RootAction
        return getOutcomes(s, getSettled(s, at))
      })
      const strike: Intent = { actorId: id, option: { kind }, picks: [{ part: 'row', value: { weaponKey: row.weaponKey, attack: row.attack, variant: row.variant } }, { part: 'target', value: target }] }
      measure(scenario, `declare a ${kind} (builder: row, target, commit)`, ready, (s) => declare(s, strike, ctx))
      const hit = predict(committed, { degree: 'hit', HOP: 5 }, [], ctx)
      measure(scenario, 'predict a hit, HOP 5, nothing bought', committed, (s) => predict(s, { degree: 'hit', HOP: 5 }, [], ctx))
      for (const buy of hit.ok ? hit.buys.filter((b) => b.part === 'overflow') : []) {
        measure(scenario, 'predict a hit, HOP 5, one purchase', committed, (s) => predict(s, { degree: 'hit', HOP: 5 }, [{ part: buy.part, value: buy.value }], ctx))
      }
      measure(scenario, 'spend the overflow of a hit on damage, HOP 5', committed, (s) => bestSpend(s, { degree: 'hit', HOP: 5 }, [], ctx))
      measure(scenario, 'spend the overflow of a hit on damage, HOP 15', committed, (s) => bestSpend(s, { degree: 'hit', HOP: 15 }, [], ctx))
    }
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const ms = (x: number) => (x >= 10 ? x.toFixed(1) : x >= 0.1 ? x.toFixed(2) : x.toFixed(3))

const started = performance.now()
for (const scenario of SCENARIOS) {
  const { state, red, blue } = setUp(scenario)
  for (const id of red) benchCharacter(scenario.name, state, id, red, blue)
  for (const id of blue) benchCharacter(scenario.name, state, id, blue, red)
}

const lines = [
  `# Sense bench`,
  '',
  `${ARENA}, fighters from humanoid / common. Cold: ${COLD} fresh copies per character, sharing nothing with what any cache has seen; after a move: ${COLD} copies as the fight is after someone else walks; warm: ${WARM} repeats on one copy. Times in ms per call, averaged over every character asked; "max" is the slowest cold call.`,
  '',
  '| scenario | question | asked of | cold mean | cold max | after a move | warm mean |',
  '|---|---|---:|---:|---:|---:|---:|',
  ...timings.map((t) => `| ${t.scenario} | ${t.question} | ${t.calls} | ${ms(mean(t.cold))} | ${ms(Math.max(...t.cold))} | ${t.moved.length ? ms(mean(t.moved)) : '-'} | ${ms(t.warm / t.calls)} |`),
  '',
  '## Cells the reach misses',
  '',
  'Cells some other movement reaches (with or without the movement surge) that the reach does not.',
  '',
  '| scenario | character | reach by | cells | missed |',
  '|---|---|---|---:|---|',
  ...missed.map((m) => `| ${m.scenario} | ${m.id} | ${m.movement} | ${m.reach} | ${m.missed.length === 0 ? 'none' : `${m.missed.length}: ${m.missed.slice(0, 6).join('; ')}${m.missed.length > 6 ? '; ...' : ''}`} |`),
  '',
  `Run took ${(performance.now() - started) / 1000 | 0} s.`,
]
const out = path.join(process.cwd(), 'reports', 'bench-sense.md')
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, lines.join('\n') + '\n')
console.log(lines.join('\n'))
