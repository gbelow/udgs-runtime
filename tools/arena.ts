import { mkdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { playFight, tally, type Fight } from '../app/domain/bot/arena'
import type { Box } from '../app/domain/bot/decision'
import type { SceneState } from '../app/domain/scene/types'
import { nearestBox } from '../app/domain/bot/boxes/nearest'
import { specBox, SPEC_WEIGHTS } from '../app/domain/bot/boxes/spec'
import { threatBox, THREAT_WEIGHTS } from '../app/domain/bot/boxes/threat'
import { getVersion, loadBox, type Version } from './lib/against'
import { CLOSE as SCENARIOS, setUp, ARENA } from './lib/scenarios'
import { run } from '../app/domain/bot/seat'
import { writeTrace } from './lib/trace'
import { formatTable } from './lib/table'

// Boxes played against each other on the arena's scenarios (tools/lib/scenarios.ts `CLOSE`),
// each seed twice with the boxes trading sides (bot/arena.ts), two seeds unless
// `--seeds` says otherwise (four fights a scenario), the fights shared
// out over worker threads.
//
//   pnpm arena [--seeds n] [--box a,b] [--only text] [--rounds n] [--workers n] [--set name=value,...] [--set2 name=value,...] [--against commit]
//   pnpm arena --trace "scenario:seed[:swapped]" [--box a,b] [--set ...] [--set2 ...] [--against ...]
//
// `--box` names the two boxes (BOXES), the first the one the report speaks
// for; `--only` plays only the scenarios whose name holds the text; `--set`
// changes weights of the first box (`THREAT_WEIGHTS`, `SPEC_WEIGHTS`), and
// `--set2` those of the second, so that a weight can be played against
// the weights as they are. `--against` plays the second box as another
// version of the code has it, a commit or a folder (tools/lib/against.ts). A broken
// fight (stalled, a decision refused, or out of steps) is listed with its seed,
// which plays it again exactly. The report goes to reports/arena/arena.md;
// `--trace` plays one fight and tells it round by round in
// reports/arena/trace-<scenario>-<seed>.md.

// `set` overrides the box's weights (`--set`, `--set2`)
type Weights = Partial<Record<string, number>>
const BOXES: Record<string, (set: Weights) => Box> = {
  nearest: () => nearestBox,
  threat: (set) => threatBox({ ...THREAT_WEIGHTS, ...set }),
  spec: (set) => specBox({ ...SPEC_WEIGHTS, ...set }),
}

// `--set exposure=0,danger=0.05`: weights of a box, each one the threat or the spec box has
const KNOWN: Record<string, unknown> = { ...THREAT_WEIGHTS, ...SPEC_WEIGHTS }

function weightsOf(text: string | null): Weights {
  if (!text) return {}
  return Object.fromEntries(text.split(',').map((pair) => {
    const [key, value] = pair.split('=')
    if (typeof KNOWN[key] !== 'number' || !Number.isFinite(Number(value))) throw new Error(`No weight "${key}" to set to "${value}": there are ${Object.keys(KNOWN).join(', ')}`)
    return [key, Number(value)]
  }))
}

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : null
}

type Job = { scenario: string; seed: number; swapped: boolean }
type Played = Job & { fight: Fight; decisions: [number, number]; ms: [number, number]; took: number }
type Setup = { boxes: [string, string]; rounds: number; set: [Weights, Weights]; against: Version | null }

const setText = (set: Weights) => Object.entries(set).map(([k, v]) => `${k} ${v}`).join(', ')

// What the report calls each box.
const nameOf = ({ boxes, set, against }: Setup, at: 0 | 1) => `${boxes[at]}${at === 1 && against ? `@${against.name}` : ''}${Object.keys(set[at]).length ? ` (${setText(set[at])})` : ''}`

async function makeBoxes({ boxes, set, against }: Setup): Promise<[() => Box, () => Box]> {
  const first = () => BOXES[boxes[0]](set[0])
  if (!against) return [first, () => BOXES[boxes[1]](set[1])]
  return [first, await loadBox(against, boxes[1], set[1])]
}

function readSetup(): Setup {
  const boxes = (flag('box') ?? 'nearest,nearest').split(',') as [string, string]
  for (const b of boxes) if (!BOXES[b]) throw new Error(`No box "${b}": there are ${Object.keys(BOXES).join(', ')}`)
  const against = flag('against')
  return { boxes, rounds: Number(flag('rounds') ?? 30), set: [weightsOf(flag('set')), weightsOf(flag('set2'))], against: against ? getVersion(against) : null }
}

// A box timed: how many decisions it made and how long they took.
function timed(box: Box, into: { n: number; ms: number }): Box {
  const told: Box = (input) => {
    const t0 = performance.now()
    const decision = box(input)
    into.ms += performance.now() - t0
    into.n++
    return decision
  }
  told.remembers = box.remembers
  told.notes = box.notes
  return told
}

async function play(jobs: Job[], setup: Setup, done: (p: Played) => void): Promise<void> {
  const make = await makeBoxes(setup)
  const set = new Map<string, { state: SceneState; red: string[]; blue: string[] }>()
  for (const job of jobs) {
    const scenario = SCENARIOS.find((s) => s.name === job.scenario)!
    const fight = set.get(job.scenario) ?? setUp(scenario)
    set.set(job.scenario, fight)
    const clocks = [{ n: 0, ms: 0 }, { n: 0, ms: 0 }] as const
    const t0 = performance.now()
    const played = playFight({ start: fight.state, sides: [fight.red, fight.blue], boxes: [timed(make[0](), clocks[0]), timed(make[1](), clocks[1])] }, job.seed, job.swapped, setup.rounds)
    done({ ...job, fight: played, decisions: [clocks[0].n, clocks[1].n], ms: [clocks[0].ms, clocks[1].ms], took: performance.now() - t0 })
  }
}

if (!isMainThread) {
  const { jobs, setup } = workerData as { jobs: Job[]; setup: Setup }
  void play(jobs, setup, (p) => parentPort!.postMessage(p))
} else if (flag('trace')) {
  // `--trace "three a side, close:3"` (`:swapped` to trade the boxes' sides):
  // that one fight, told round by round (tools/lib/trace.ts)
  const [name, seedText, swapText] = flag('trace')!.split(':')
  const scenario = SCENARIOS.find((s) => s.name === name)
  if (!scenario) throw new Error(`No scenario "${name}": there are ${SCENARIOS.map((s) => s.name).join(', ')}`)
  const setup = readSetup()
  const seed = Number(seedText ?? 1)
  const swapped = swapText === 'swapped'
  const { state, red, blue } = setUp(scenario)
  const [redAt, blueAt] = swapped ? ([1, 0] as const) : ([0, 1] as const)
  const title = `${scenario.name}, seed ${seed}: red ${nameOf(setup, redAt)}, blue ${nameOf(setup, blueAt)}`
  const out = path.join(process.cwd(), 'reports', 'arena', `trace-${scenario.name.replace(/[^a-z0-9]+/gi, '-')}-${seed}${swapped ? '-swapped' : ''}.md`)
  void makeBoxes(setup).then((make) => {
    const played = run(state, [{ id: 'red', members: red, box: make[redAt]() }, { id: 'blue', members: blue, box: make[blueAt]() }], { seed, maxRounds: setup.rounds })
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, writeTrace(title, played, { red, blue }) + '\n')
    console.log(`${played.end} in round ${played.rounds}: ${out}`)
  })
} else {
  const seeds = Number(flag('seeds') ?? 2)
  const only = flag('only')
  const setup = readSetup()
  const scenarios = SCENARIOS.filter((s) => !only || s.name.includes(only))
  const jobs: Job[] = scenarios.flatMap((s) => Array.from({ length: seeds }, (_, i) => [false, true].map((swapped) => ({ scenario: s.name, seed: i + 1, swapped }))).flat())
  const workers = Math.max(1, Math.min(Number(flag('workers') ?? availableParallelism() - 1), jobs.length))

  const started = performance.now()
  const results: Played[] = []
  // each worker takes a share of every scenario, so each sets up all of them
  const shares = Array.from({ length: workers }, (_, w) => jobs.filter((_, i) => i % workers === w))
  const progress = () => process.stdout.write(`\r${results.length}/${jobs.length} fights`)
  Promise.all(shares.map((share) => new Promise<void>((resolve, reject) => {
    const worker = new Worker(path.join(process.cwd(), 'tools', 'arena.ts'), { workerData: { jobs: share, setup } })
    worker.on('message', (p: Played) => { results.push(p); progress() })
    worker.on('error', reject)
    worker.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`a worker stopped with ${code}`))))
  }))).then(() => report(scenarios.map((s) => s.name), results, setup, seeds, workers, performance.now() - started))
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const ms = (x: number) => (x >= 10 ? x.toFixed(1) : x.toFixed(2))

function report(scenarios: string[], results: Played[], setup: Setup, seeds: number, workers: number, took: number): void {
  const { rounds } = setup
  const [A, B] = [nameOf(setup, 0), nameOf(setup, 1)]
  const stats = scenarios.map((name) => {
    const of = results.filter((r) => r.scenario === name)
    const t = tally(of.map((r) => r.fight))
    const per = (i: 0 | 1) => {
      const n = of.reduce((a, r) => a + r.decisions[i], 0)
      return { n: n / Math.max(1, of.length), ms: of.reduce((a, r) => a + r.ms[i], 0) / Math.max(1, n) }
    }
    const took = of.map((r) => r.took / 1000)
    const down = (i: 0 | 1) => (of.reduce((s, r) => s + r.fight.down[i], 0) / Math.max(1, of.length)).toFixed(1)
    return { name, t, a: per(0), b: per(1), took, down: [down(0), down(1)] }
  })
  const resultsTable = formatTable(
    ['scenario', 'won', 'lost', 'drawn', 'broken', `${A}'s score`, '95% interval', 'told apart', 'seeds', 'rounds', `down: ${A}`, `down: ${B}`],
    stats.map(({ name, t, down }) => [name, t.wins, t.losses, t.draws, t.broken, pct(t.score), `${pct(t.low)} to ${pct(t.high)}`, t.low <= 0.5 && t.high >= 0.5 ? 'no' : 'yes', t.pairs.join('-'), t.rounds.toFixed(1), down[0], down[1]]),
    ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'right', 'right', 'right', 'right'],
  )
  const timeTable = formatTable(
    ['scenario', 's a fight (mean)', 's a fight (max)', `${A}: decisions`, `${A}: ms each`, `${B}: decisions`, `${B}: ms each`],
    stats.map(({ name, took, a, b }) => [name, (took.reduce((x, y) => x + y, 0) / Math.max(1, took.length)).toFixed(1), Math.max(0, ...took).toFixed(1), a.n.toFixed(0), ms(a.ms), b.n.toFixed(0), ms(b.ms)]),
    ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
  )
  const broken = results.filter((r) => r.fight.result === 'broken')
  const lines = [
    '# Arena',
    '',
    `${A} against ${B} on ${ARENA}: ${seeds} seeds a scenario, each played twice with the boxes trading sides; a draw at the end of round ${rounds}.`,
    '',
    '## Results',
    '',
    `Won, lost and drawn are ${A}'s. The score counts a draw as half, over the fights not broken; "told apart" says whether its 95% interval leaves out 50%. Seeds are those it came out ahead in over the two fights of one, level and behind. Rounds are those a fight reached; down is how many of each box's characters went down, a fight.`,
    '',
    resultsTable,
    '',
    '## Time',
    '',
    `Seconds are the wall time of one fight on one worker, ${workers} workers at once. Decisions are a fight's, with the mean ms each.`,
    '',
    timeTable,
    '',
    ...(broken.length
      ? ['## Broken fights', '', ...broken.slice(0, 20).map((r) => `- ${r.scenario}, seed ${r.seed}${r.swapped ? ', swapped' : ''}: ${r.fight.faults.slice(0, 3).join('; ')}`), '']
      : []),
    `${results.length} fights in ${(took / 1000).toFixed(1)} s.`,
  ]
  const out = path.join(process.cwd(), 'reports', 'arena', 'arena.md')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, lines.join('\n') + '\n')
  process.stdout.write('\n')
  console.log(lines.join('\n'))
}
