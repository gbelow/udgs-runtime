import { mkdirSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { rollD10, seededRng } from '../../app/domain/combat/dice'
import { simulate } from '../../app/domain/bot/simulate'
import { SCENARIOS } from './scenarios'
import { renderLog, renderSummary, type Run } from './report'

// pnpm sim [scenario ...] [--seeds N] [--rounds N]
// Plays each scenario with the bots over a run of seeds and writes what
// happened to reports/sim-<scenario>.md.

const { values, positionals } = parseArgs({ allowPositionals: true, options: { seeds: { type: 'string', default: '200' }, rounds: { type: 'string', default: '20' } } })
const seeds = Number(values.seeds)
const maxRounds = Number(values.rounds)
const chosen = positionals.length > 0 ? SCENARIOS.filter((s) => positionals.includes(s.name)) : SCENARIOS

mkdirSync('reports', { recursive: true })
for (const scenario of chosen) {
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
