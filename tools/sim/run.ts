import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { Worker } from 'node:worker_threads'
import { DEFAULT_TUNING, type Tuning } from '../../app/domain/bot/party'
import { listCatalog, makeScenario, PRESETS, type Matchup } from './scenarios'
import { renderDecisions, renderLog, renderSummary, type Run } from './report'
import type { Job } from './worker'

// pnpm sim [preset ...]                      the presets (all, or those named)
// pnpm sim --side "Ogre" --side "Human Warrior*2" [--distance 6] [--name ogres]
//                                            a matchup of your own: one --side
//                                            per side, catalog names comma
//                                            separated, `*N` for N of one
// pnpm sim ... --tune horizon=0,threat=1     how the bots weigh (see Tuning): once
//                                            for every side, or once per side in
//                                            order, to compare settings
// pnpm sim --list                            the catalog's characters
// Either takes [--seeds N] [--rounds N]. Each is played with a bot per side
// over a run of seeds, and what happened goes to reports/sim-<name>.md.

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    side: { type: 'string', multiple: true },
    tune: { type: 'string', multiple: true },
    distance: { type: 'string', default: '6' },
    name: { type: 'string' },
    seeds: { type: 'string', default: '8' },
    rounds: { type: 'string', default: '10' },
    list: { type: 'boolean', default: false },
  },
})

if (values.list) {
  console.log(listCatalog().join('\n'))
  process.exit(0)
}

// "horizon=0,threat=1" as a tuning, refusing a name the bots do not weigh with.
function parseTuning(text: string): Partial<Tuning> {
  return Object.fromEntries(text.split(',').map((pair) => {
    const [key, value] = pair.split('=').map((s) => s.trim())
    if (!(key in DEFAULT_TUNING) || Number.isNaN(Number(value))) throw new Error(`Cannot tune "${pair}". Tunable: ${Object.keys(DEFAULT_TUNING).join(', ')}`)
    return [key, Number(value)]
  }))
}

const tuning = (values.tune ?? []).map(parseTuning)
const sides = (values.side ?? []).map((s) => s.split(',').map((e) => e.trim()))
const custom: Matchup[] = sides.length > 0
  ? [{ name: values.name ?? sides.map((s) => s.join('+')).join('-vs-').replace(/[^\w+*-]+/g, '_'), sides, distance: Number(values.distance) }]
  : []
const chosen = custom.length > 0 ? custom : positionals.length > 0 ? PRESETS.filter((p) => positionals.includes(p.name)) : PRESETS
const matchups = chosen.map((m) => ({ ...m, tuning }))
const seeds = Number(values.seeds)
const maxRounds = Number(values.rounds)

// The seeds of a matchup are dealt round-robin to a pool of workers, one per
// core, which stay up from one matchup to the next.
const pool = Array.from({ length: Math.min(cpus().length, seeds) }, () => new Worker(path.join(__dirname, 'worker.ts')))

function playSeeds(matchup: Matchup): Promise<Run[]> {
  const jobs = pool.map((worker, i) => new Promise<Run[]>((resolve, reject) => {
    const mine = Array.from({ length: seeds }, (_, s) => s + 1).filter((seed) => seed % pool.length === i)
    worker.once('message', resolve)
    worker.once('error', reject)
    worker.postMessage({ matchup, seeds: mine, maxRounds } satisfies Job)
  }))
  return Promise.all(jobs).then((runs) => runs.flat().sort((a, b) => a.seed - b.seed))
}

async function main() {
  mkdirSync('reports', { recursive: true })
  for (const matchup of matchups) {
    const started = Date.now()
    const scenario = makeScenario(matchup)
    const { parties, labels } = scenario.build()
    const runs = await playSeeds(matchup)
    const odd = runs.find((r) => r.sim.ending !== 'won')
    const text = [renderSummary(scenario.name, scenario.about, runs, parties, labels), renderLog(runs[0], parties, labels), renderDecisions(runs[0]), ...(odd && odd !== runs[0] ? [renderLog(odd, parties, labels)] : [])].join('\n')
    const suffix = tuning.map((t) => Object.entries(t).map(([k, v]) => `${k}${v}`).join('_')).map((t) => `-${t}`).join('')
    const file = `reports/sim-${scenario.name}${suffix}.md`
    writeFileSync(file, text)
    console.log(`${scenario.name}: ${runs.length} fights in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${file}`)
  }
  await Promise.all(pool.map((w) => w.terminate()))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
