import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { rollD10, seededRng } from '../../app/domain/combat/dice'
import { simulate } from '../../app/domain/bot/simulate'
import { listCatalog, makeScenario, PRESETS, type Matchup } from './scenarios'
import { renderLog, renderSummary, type Run } from './report'

// pnpm sim [preset ...]                      the presets (all, or those named)
// pnpm sim --side "Ogre" --side "Human Warrior*2" [--distance 6] [--name ogres]
//                                            a matchup of your own: one --side
//                                            per side, catalog names comma
//                                            separated, `*N` for N of one
// pnpm sim --list                            the catalog's characters
// Either takes [--seeds N] [--rounds N]. Each is played with a bot per side
// over a run of seeds, and what happened goes to reports/sim-<name>.md.

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    side: { type: 'string', multiple: true },
    distance: { type: 'string', default: '6' },
    name: { type: 'string' },
    seeds: { type: 'string', default: '200' },
    rounds: { type: 'string', default: '20' },
    list: { type: 'boolean', default: false },
  },
})

if (values.list) {
  console.log(listCatalog().join('\n'))
  process.exit(0)
}

const sides = (values.side ?? []).map((s) => s.split(',').map((e) => e.trim()))
const custom: Matchup[] = sides.length > 0
  ? [{ name: values.name ?? sides.map((s) => s.join('+')).join('-vs-').replace(/[^\w+*-]+/g, '_'), sides, distance: Number(values.distance) }]
  : []
const matchups = custom.length > 0 ? custom : positionals.length > 0 ? PRESETS.filter((p) => positionals.includes(p.name)) : PRESETS
const seeds = Number(values.seeds)
const maxRounds = Number(values.rounds)

mkdirSync('reports', { recursive: true })
for (const scenario of matchups.map(makeScenario)) {
  const { state, parties, labels } = scenario.build()
  const runs: Run[] = []
  for (let seed = 1; seed <= seeds; seed++) {
    const rng = seededRng(seed)
    let n = 0
    runs.push({ seed, sim: simulate(state, parties, (explodes) => rollD10(explodes, rng), () => `x${++n}`, maxRounds) })
  }
  const odd = runs.find((r) => r.sim.ending !== 'won')
  const text = [renderSummary(scenario.name, scenario.about, runs, parties, labels), renderLog(runs[0], parties, labels), ...(odd && odd !== runs[0] ? [renderLog(odd, parties, labels)] : [])].join('\n')
  const file = `reports/sim-${scenario.name}.md`
  writeFileSync(file, text)
  console.log(`${scenario.name}: ${runs.length} fights -> ${file}`)
}
