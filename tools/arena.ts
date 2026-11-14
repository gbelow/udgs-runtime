import { mkdirSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { playFight, tally, type Fight } from '../app/domain/bot/arena'
import type { Box } from '../app/domain/bot/decision'
import type { SceneState } from '../app/domain/scene/types'
import { nearestBox } from '../app/domain/bot/boxes/nearest'
import { threatBox, THREAT_WEIGHTS, type ThreatWeights } from '../app/domain/bot/boxes/threat'
import { CLOSE as SCENARIOS, setUp, ARENA } from './lib/scenarios'

// Boxes played against each other on the arena's scenarios (tools/lib/scenarios.ts `CLOSE`),
// each seed twice with the boxes trading sides (bot/arena.ts), the fights shared
// out over worker threads.
//
//   pnpm arena [--seeds n] [--box a,b] [--only text] [--rounds n] [--workers n] [--set name=value,...]
//
// `--box` names the two boxes (BOXES), the first the one the report speaks
// for; `--only` plays only the scenarios whose name holds the text; `--set`
// changes weights of the threat box (`THREAT_WEIGHTS`). A broken
// fight (stalled, a decision refused, or out of steps) is listed with its seed,
// which plays it again exactly. The report goes to reports/arena/arena.md.

// `set` overrides the threat box's weights (`--set`), for every threat box in the fight
const BOXES: Record<string, (set: Partial<ThreatWeights>) => Box> = {
  nearest: () => nearestBox,
  threat: (set) => threatBox({ ...THREAT_WEIGHTS, ...set }),
}

// `--set exposure=0,danger=0.05`: weights of the threat box, each one it has
function weightsOf(text: string | null): Partial<ThreatWeights> {
  if (!text) return {}
  return Object.fromEntries(text.split(',').map((pair) => {
    const [key, value] = pair.split('=')
    if (!(key in THREAT_WEIGHTS) || typeof THREAT_WEIGHTS[key as keyof ThreatWeights] !== 'number' || !Number.isFinite(Number(value))) throw new Error(`No weight "${key}" to set to "${value}": there are ${Object.keys(THREAT_WEIGHTS).join(', ')}`)
    return [key, Number(value)]
  }))
}

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 ? process.argv[at + 1] : null
}

type Job = { scenario: string; seed: number; swapped: boolean }
type Played = Job & { fight: Fight; decisions: [number, number]; ms: [number, number]; took: number }
type Setup = { boxes: [string, string]; rounds: number; set: Partial<ThreatWeights> }

// A box timed: how many decisions it made and how long they took.
function timed(box: Box, into: { n: number; ms: number }): Box {
  return (input) => {
    const t0 = performance.now()
    const decision = box(input)
    into.ms += performance.now() - t0
    into.n++
    return decision
  }
}

function play(jobs: Job[], { boxes, rounds, set: weights }: Setup, done: (p: Played) => void): void {
  const set = new Map<string, { state: SceneState; red: string[]; blue: string[] }>()
  for (const job of jobs) {
    const scenario = SCENARIOS.find((s) => s.name === job.scenario)!
    const fight = set.get(job.scenario) ?? setUp(scenario)
    set.set(job.scenario, fight)
    const clocks = [{ n: 0, ms: 0 }, { n: 0, ms: 0 }] as const
    const t0 = performance.now()
    const played = playFight({ start: fight.state, sides: [fight.red, fight.blue], boxes: [timed(BOXES[boxes[0]](weights), clocks[0]), timed(BOXES[boxes[1]](weights), clocks[1])] }, job.seed, job.swapped, rounds)
    done({ ...job, fight: played, decisions: [clocks[0].n, clocks[1].n], ms: [clocks[0].ms, clocks[1].ms], took: performance.now() - t0 })
  }
}

if (!isMainThread) {
  const { jobs, setup } = workerData as { jobs: Job[]; setup: Setup }
  play(jobs, setup, (p) => parentPort!.postMessage(p))
} else {
  const seeds = Number(flag('seeds') ?? 20)
  const boxes = (flag('box') ?? 'nearest,nearest').split(',') as [string, string]
  for (const b of boxes) if (!BOXES[b]) throw new Error(`No box "${b}": there are ${Object.keys(BOXES).join(', ')}`)
  const only = flag('only')
  const setup: Setup = { boxes, rounds: Number(flag('rounds') ?? 30), set: weightsOf(flag('set')) }
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

function report(scenarios: string[], results: Played[], { boxes, rounds, set }: Setup, seeds: number, workers: number, took: number): void {
  const rows = scenarios.map((name) => {
    const of = results.filter((r) => r.scenario === name)
    const t = tally(of.map((r) => r.fight))
    const per = (i: 0 | 1) => {
      const n = of.reduce((a, r) => a + r.decisions[i], 0)
      return { n: n / Math.max(1, of.length), ms: of.reduce((a, r) => a + r.ms[i], 0) / Math.max(1, n) }
    }
    const [a, b] = [per(0), per(1)]
    const unsure = t.low <= 0.5 && t.high >= 0.5 ? ' (not told apart yet)' : ''
    const took = of.map((r) => r.took / 1000)
    const secs = `${(took.reduce((x, y) => x + y, 0) / Math.max(1, took.length)).toFixed(1)} / ${Math.max(0, ...took).toFixed(1)}`
    const down = (i: 0 | 1) => (of.reduce((s, r) => s + r.fight.down[i], 0) / Math.max(1, of.length)).toFixed(1)
    return `| ${name} | ${t.wins}/${t.losses}/${t.draws} | ${t.broken} | ${pct(t.score)} [${pct(t.low)}, ${pct(t.high)}]${unsure} | ${t.rounds.toFixed(1)} | ${secs} | ${down(0)} / ${down(1)} | ${a.n.toFixed(0)} @ ${ms(a.ms)} | ${b.n.toFixed(0)} @ ${ms(b.ms)} |`
  })
  const broken = results.filter((r) => r.fight.result === 'broken')
  const lines = [
    '# Arena',
    '',
    `${boxes[0]} against ${boxes[1]} on ${ARENA}, ${seeds} seeds a scenario, each played twice with the boxes trading sides; a draw at the end of round ${rounds}. The score is ${boxes[0]}'s, a draw counted half, over the fights not broken, with its 95% interval. Rounds are those a fight reached; seconds are the wall time of one fight on one worker. Decisions are per fight, with the mean ms each.${Object.keys(set).length ? ` Threat weights set: ${Object.entries(set).map(([k, v]) => `${k} ${v}`).join(', ')}.` : ''}`,
    '',
    `| scenario | won/lost/drawn | broken | score | rounds | s a fight (mean / max) | down (${boxes[0]} / ${boxes[1]}) | ${boxes[0]} decisions | ${boxes[1]} decisions |`,
    '|---|---:|---:|---|---:|---:|---:|---:|---:|',
    ...rows,
    '',
    ...(broken.length
      ? ['## Broken fights', '', ...broken.slice(0, 20).map((r) => `- ${r.scenario}, seed ${r.seed}${r.swapped ? ', swapped' : ''}: ${r.fight.faults.slice(0, 3).join('; ')}`), '']
      : []),
    `${results.length} fights on ${workers} workers in ${(took / 1000).toFixed(1)} s.`,
  ]
  const out = path.join(process.cwd(), 'reports', 'arena', 'arena.md')
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, lines.join('\n') + '\n')
  process.stdout.write('\n')
  console.log(lines.join('\n'))
}
