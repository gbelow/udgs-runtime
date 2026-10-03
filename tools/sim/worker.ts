import { parentPort } from 'node:worker_threads'
import { rollD10, seededRng } from '../../app/domain/combat/dice'
import { simulate } from '../../app/domain/bot/simulate'
import { makeScenario, type Matchup } from './scenarios'
import type { Run } from './report'

// A worker of the simulator's pool: plays the seeds it is given of a matchup
// and sends the runs back.

export type Job = { matchup: Matchup; seeds: number[]; maxRounds: number }

function play({ matchup, seeds, maxRounds }: Job): Run[] {
  const { state, parties } = makeScenario(matchup).build()
  return seeds.map((seed) => {
    const rng = seededRng(seed)
    let n = 0
    return { seed, sim: simulate(state, parties, (explodes) => rollD10(explodes, rng), () => `x${++n}`, maxRounds) }
  })
}

parentPort?.on('message', (job: Job) => parentPort?.postMessage(play(job)))
