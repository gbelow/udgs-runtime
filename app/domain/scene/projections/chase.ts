import type { SceneState } from '../types'
import { CHASE_COVERS, CHASE_TIERS, SKIRMISH_STANCES, type ChaseCover, type ChaseSide, type ChaseTier, type SkirmishStance } from '../../lists'
import { perState } from '../../perState'
import { getFightName } from '../rules/fighters'
import { getFightBusy, getNextRoundBar } from '../rules/turn'
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
  // what the table does next for the group
  next: string
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
  // why the chase cannot be ended now
  endBar: string | null
  // what the table does next, before any group's own step
  next: string | null
  // why the round cannot end yet
  roundBar: string | null
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

// What the table does next for the group, in the order a chase round goes:
// run or skirmish, the winner's way, the round played out, the next round.
function getGroupNext(state: SceneState, id: string, followers: string[]): string {
  const chase = state.chase!
  const g = chase.groups[id]
  const endRound = 'everyone ends their turn and agrees to end the round, then next round'
  if (g.escaped) return 'they got away'
  if (g.fighting) return 'fight it out; run again if they break away, or end the chase'
  if (g.run && !g.run.chosen) return `${g.run.winner === 'quarry' ? state.parties[id]?.name || 'the quarry' : followers.join(', ') || 'the pursuers'} won: close in or pull away`
  if (g.run && g.tier === 'combat') return `routing: everyone takes turns with their AP, the pursuers at +2; ${endRound}`
  if (g.run) return endRound
  if ([id, ...getFollowers(state, id)].some((p) => chase.stances[p])) return 'skirmish: each party below picks shoot or approach, then everyone takes turns with the AP shown'
  const bar = getRunBar(state, id)
  if (bar === 'nobody follows them') return 'nobody follows them: pick a pursuer below to follow, or they drift away'
  if (bar) return bar
  return g.tier === 'shooting' || g.tier === 'far' ? 'run, or pick skirmish stances below' : 'run'
}

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
    next: getGroupNext(state, id, getFollowers(state, id).map((p) => partyName(state, p))),
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
    endBar: getFightBusy(state),
    next: !chase ? 'tick the parties running away, pick how far apart they start, and start the chase'
      : state.round === 0 ? 'press start combat to begin the first round' : null,
    roundBar: chase && state.round > 0 ? getNextRoundBar(state) : null,
    stances: SKIRMISH_STANCES,
    covers: CHASE_COVERS,
    runners: chase ? (['quarry', 'pursuers'] as const).flatMap((side) => getRunners(state, side).map((c) => ({ id: c.id, name: getFightName(state, c.id), side, cover: chase.cover[c.id] ?? null }))) : [],
    elapsed: clock(state.elapsed),
    roundTakes: clock(getRoundSeconds(state)),
  }
}

export const getChasePanel = perState(buildChasePanel)
export const getChaseDigest = perState((state: SceneState) => JSON.stringify(getChasePanel(state)))
