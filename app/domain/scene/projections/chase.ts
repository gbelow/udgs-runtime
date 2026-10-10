import type { SceneState } from '../types'
import { CHASE_COVERS, CHASE_TIERS, SKIRMISH_STANCES, type ChaseCover, type ChaseSide, type ChaseTier, type SkirmishStance } from '../../lists'
import { perState } from '../../perState'
import { getFightName } from '../rules/fighters'
import { getFightBusy } from '../rules/turn'
import { getCaught, getChaseWays, getFightFirst, getFollowBar, getFollowed, getFollowers, getJoinBar, getMembers, getPairGroup, getPursuerParties, getQuarryGroups, getRoundSeconds, getRunBar, getRunners, getSkirmishAP, getStanceBar, type ChaseWay } from '../rules/chase'

export type ChaseRunnerRow = { id: string; name: string; side: ChaseSide; speed: number; slowest: boolean }

type Option = { id: string; name: string; bar: string | null }

// A group running away, and its chase with whoever follows it.
export type ChaseGroupRow = {
  id: string
  name: string
  tier: ChaseTier
  escaped: boolean
  fighting: boolean
  // why the table cannot have it fight or run again now
  fightBar: string | null
  // rounds in a row nobody has followed it
  unfollowed: number
  followers: string[]
  // its members, and whether each has turned around to face the pursuers
  members: { id: string; name: string; turned: boolean }[]
  caught: string[]
  runBar: string | null
  run: { tier: ChaseTier; quarry: number; pursuers: number; winner: ChaseSide | 'draw'; coin: number | null; runners: ChaseRunnerRow[] } | null
  ways: ChaseWay[]
}

// A party in the chase: the group it follows and the ones it could follow
// instead (a pursuing party), its skirmish stance, why it cannot take one and
// the AP it has once its pair has chosen, and whether it is on its way to a
// fight or the fights it could set off for.
export type ChasePartyRow = {
  id: string
  name: string
  side: ChaseSide
  follows: string | null
  followOptions: Option[]
  skirmish: boolean
  stance: SkirmishStance | null
  stanceBar: string | null
  AP: number | null
  joining: { to: string; rounds: number } | null
  joinOptions: Option[]
}

export type ChasePanel = {
  tiers: readonly ChaseTier[]
  // the fight parties, and whether each is running away
  parties: { id: string; name: string; quarry: boolean }[]
  chasing: boolean
  groups: ChaseGroupRow[]
  chaseParties: ChasePartyRow[]
  // combat.tex "Escape": the fight played out before anyone runs
  fightFirst: string | null
  stances: readonly SkirmishStance[]
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

const partyName = (state: SceneState, id: string) => state.parties[id]?.name || 'no name'

function buildGroupRow(state: SceneState, id: string): ChaseGroupRow {
  const chase = state.chase!
  const g = chase.groups[id]
  const run = g.run
  return {
    id,
    name: partyName(state, id),
    tier: g.tier,
    escaped: g.escaped,
    fighting: g.fighting,
    fightBar: g.escaped ? 'they got away' : getFightBusy(state),
    unfollowed: g.unfollowed,
    followers: getFollowers(state, id).map((p) => partyName(state, p)),
    members: getMembers(state, id).map((c) => ({ id: c.id, name: getFightName(state, c.id), turned: chase.turned.includes(c.id) })),
    caught: getCaught(state, id).map((c) => c.reason),
    runBar: getRunBar(state, id),
    run: run && {
      tier: run.tier,
      quarry: run.quarry,
      pursuers: run.pursuers,
      winner: run.winner ?? 'draw',
      coin: run.coin,
      runners: Object.entries(run.speeds).map(([cid, speed]) => {
        const side = chase.groups[state.partyOf[cid] ?? ''] ? 'quarry' : 'pursuers'
        return { id: cid, name: getFightName(state, cid), side, speed, slowest: speed === (side === 'quarry' ? run.quarry : run.pursuers) }
      }),
    },
    ways: getChaseWays(state, id),
  }
}

function buildPartyRow(state: SceneState, id: string, side: ChaseSide, groups: string[], fighting: string[]): ChasePartyRow {
  const chase = state.chase!
  const followed = side === 'pursuers' ? getFollowed(state, id) : null
  const group = getPairGroup(state, id)
  const tier = group ? chase.groups[group].tier : null
  return {
    id,
    name: partyName(state, id),
    side,
    follows: followed && partyName(state, followed),
    followOptions: side === 'pursuers' ? groups.filter((g) => g !== followed).map((g) => ({ id: g, name: partyName(state, g), bar: getFollowBar(state, id, g) })) : [],
    skirmish: tier === 'shooting' || tier === 'far' || !!chase.stances[id],
    stance: chase.stances[id] ?? null,
    stanceBar: getStanceBar(state, id),
    AP: getSkirmishAP(state, id),
    joining: chase.joining[id] ? { to: partyName(state, chase.joining[id].to), rounds: chase.joining[id].rounds } : null,
    joinOptions: chase.joining[id] ? [] : fighting.filter((g) => g !== id).map((g) => ({ id: g, name: partyName(state, g), bar: getJoinBar(state, id, g) })),
  }
}

function buildChasePanel(state: SceneState): ChasePanel {
  const chase = state.chase
  const groups = getQuarryGroups(state)
  const fighting = groups.filter((g) => chase!.groups[g].fighting)
  return {
    tiers: CHASE_TIERS,
    parties: Object.entries(state.parties).map(([id, p]) => ({ id, name: p.name || 'no name', quarry: !!chase?.groups[id] })),
    chasing: chase !== null,
    groups: chase ? groups.map((g) => buildGroupRow(state, g)) : [],
    chaseParties: chase ? [
      ...groups.map((g) => buildPartyRow(state, g, 'quarry', groups, fighting)),
      ...getPursuerParties(state).map((p) => buildPartyRow(state, p, 'pursuers', groups, fighting)),
    ] : [],
    fightFirst: chase ? getFightFirst(state) : null,
    stances: SKIRMISH_STANCES,
    covers: CHASE_COVERS,
    runners: chase ? (['quarry', 'pursuers'] as const).flatMap((side) => getRunners(state, side).map((c) => ({ id: c.id, name: getFightName(state, c.id), side, cover: chase.cover[c.id] ?? null }))) : [],
    elapsed: clock(state.elapsed),
    roundTakes: clock(getRoundSeconds(state)),
  }
}

export const getChasePanel = perState(buildChasePanel)
export const getChaseDigest = perState((state: SceneState) => JSON.stringify(getChasePanel(state)))
