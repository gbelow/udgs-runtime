import type { SceneState } from '../types'
import { CHASE_COVERS, CHASE_SIDES, CHASE_TIERS, SKIRMISH_STANCES, type ChaseCover, type ChaseSide, type ChaseTier, type SkirmishStance } from '../../lists'
import { perState } from '../../perState'
import { getFightName } from '../rules/fighters'
import { getCaught, getChaseSide, getChaseWays, getRunners, getRunBar, getRoundSeconds, getSkirmishAP, getStanceBar, type ChaseWay } from '../rules/chase'

export type ChaseRunnerRow = { id: string; name: string; side: ChaseSide; speed: number; slowest: boolean }

export type ChasePanel = {
  tiers: readonly ChaseTier[]
  // the fight parties, and whether each is running away
  parties: { id: string; name: string; quarry: boolean }[]
  chasing: boolean
  // the quarry, and whether each has turned around to face the pursuers
  quarry: { id: string; name: string; turned: boolean }[]
  tier: ChaseTier | null
  escaped: boolean
  caught: string[]
  runBar: string | null
  run: { tier: ChaseTier; quarry: number; pursuers: number; winner: ChaseSide | 'draw'; coin: number | null; runners: ChaseRunnerRow[] } | null
  ways: ChaseWay[]
  // combat.tex "Skirmish": each side's stance, why it cannot take one, and
  // the AP it has once both have
  stances: readonly SkirmishStance[]
  skirmish: { side: ChaseSide; stance: SkirmishStance | null; bar: string | null; AP: number | null }[]
  // combat.tex "Cover": everyone in the chase and the cover the table gives them
  covers: readonly ChaseCover[]
  runners: { id: string; name: string; side: ChaseSide; cover: ChaseCover | null }[]
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
    quarry: chase ? getRunners(state, 'quarry').map((c) => ({ id: c.id, name: getFightName(state, c.id), turned: chase.turned.includes(c.id) })) : [],
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
    stances: SKIRMISH_STANCES,
    skirmish: chase && (chase.tier === 'shooting' || Object.keys(chase.stances).length > 0) ? CHASE_SIDES.map((side) => ({ side, stance: chase.stances[side] ?? null, bar: getStanceBar(state, side), AP: getSkirmishAP(state, side) })) : [],
    covers: CHASE_COVERS,
    runners: chase ? CHASE_SIDES.flatMap((side) => getRunners(state, side).map((c) => ({ id: c.id, name: getFightName(state, c.id), side, cover: chase.cover[c.id] ?? null }))) : [],
    elapsed: clock(state.elapsed),
    roundTakes: clock(getRoundSeconds(state)),
  }
}

export const getChasePanel = perState(buildChasePanel)
export const getChaseDigest = perState((state: SceneState) => JSON.stringify(getChasePanel(state)))

