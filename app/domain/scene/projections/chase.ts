import type { SceneState } from '../types'
import { CHASE_TIERS, type ChaseSide, type ChaseTier } from '../../lists'
import { perState } from '../../perState'
import { getFightName } from '../rules/fighters'
import { getCaught, getChaseSide, getChaseWays, getRunBar, getRoundSeconds, type ChaseWay } from '../rules/chase'

export type ChaseRunnerRow = { id: string; name: string; side: ChaseSide; speed: number; slowest: boolean }

export type ChasePanel = {
  tiers: readonly ChaseTier[]
  // the fight parties, and whether each is running away
  parties: { id: string; name: string; quarry: boolean }[]
  chasing: boolean
  tier: ChaseTier | null
  escaped: boolean
  caught: string[]
  runBar: string | null
  run: { tier: ChaseTier; quarry: number; pursuers: number; winner: ChaseSide | 'draw'; coin: number | null; runners: ChaseRunnerRow[] } | null
  ways: ChaseWay[]
  elapsed: string
  roundTakes: string
}

// Seconds as the table reads them: minutes and seconds.
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m === 0 ? `${s} s` : s === 0 ? `${m} min` : `${m} min ${s} s`
}

function buildChasePanel(state: SceneState): ChasePanel {
  const chase = state.chase
  const run = chase?.run ?? null
  return {
    tiers: CHASE_TIERS,
    parties: Object.entries(state.parties).map(([id, p]) => ({ id, name: p.name || 'no name', quarry: !!chase?.quarry.includes(id) })),
    chasing: chase !== null,
    tier: chase?.tier ?? null,
    escaped: !!chase?.escaped,
    caught: getCaught(state).map((c) => c.reason),
    runBar: getRunBar(state),
    run: run && {
      tier: run.tier,
      quarry: run.quarry,
      pursuers: run.pursuers,
      winner: run.winner ?? 'draw',
      coin: run.coin,
      runners: Object.entries(run.speeds).map(([id, speed]) => {
        const side = getChaseSide(state, id)
        return { id, name: getFightName(state, id), side, speed, slowest: speed === (side === 'quarry' ? run.quarry : run.pursuers) }
      }),
    },
    ways: getChaseWays(state),
    elapsed: clock(state.elapsed),
    roundTakes: clock(getRoundSeconds(state)),
  }
}

export const getChasePanel = perState(buildChasePanel)
export const getChaseDigest = perState((state: SceneState) => JSON.stringify(getChasePanel(state)))

