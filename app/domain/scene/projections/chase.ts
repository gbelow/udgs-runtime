import type { ChaseDeclaration, SceneState } from '../types'
import { CHASE_COVERS, CHASE_MOVES, CHASE_TIERS, CROSSING_SKILLS, type ChaseCover, type ChaseMove, type ChaseRole, type ChaseSide, type ChaseTier, type ChaseWay } from '../../lists'
import { perState } from '../../perState'
import { getFightName } from '../rules/fighters'
import { getFightBusy } from '../rules/turn'
import { getNextRoundNote } from './turn'
import { canTurnAround, getCaught, getChasers, getChaseParties, getChaseStage, getCrossBar, getDeclareBar, getDeclareOrder, getDeclarers, getFightBar, getFightFirst, getFollowBar, getJoinBar, getLink, getMembers, getMergeBar, getObstacleOwner, getPutBackBar, getResolveBar, getRoundSeconds, getSkirmishAP, getTeam, isDisconnected, isEnemyLink, isFrozen } from '../rules/chase'

type Option = { id: string; name: string; bar: string | null }

// The run of the party's link this round.
export type ChaseRunRow = {
  tier: ChaseTier
  chaser: number
  chased: number
  contest: boolean
  winner: ChaseRole | null
  coin: number | null
  way: ChaseWay | null
  skirmish: boolean
  runners: { id: string; name: string; role: ChaseRole; speed: number; slowest: boolean }[]
}

// A party in the chase: its team, where it stands, who it chases and how
// far, who chases it, what it declared and what it may declare, how its
// link ran, and what the table may do with it.
export type ChasePartyRow = {
  id: string
  name: string
  team: ChaseSide
  status: string
  out: boolean
  fighting: boolean
  chases: { name: string; tier: ChaseTier; enemy: boolean; frozen: boolean } | null
  chasedBy: string[]
  members: { id: string; name: string; turned: boolean }[]
  turnable: boolean
  caught: string[]
  declares: boolean
  declaration: ChaseDeclaration | null
  moves: { move: ChaseMove; bar: string | null }[]
  scoutBar: string | null
  run: ChaseRunRow | null
  AP: number | null
  feature: { what: string; tier: ChaseTier; obstacle: boolean; reached: boolean } | null
  crossBar: string | null
  followOptions: Option[]
  putBackOptions: Option[]
  joinOptions: Option[]
  joining: string | null
  mergeBar: string | null
  giveUpBar: string | null
  fightBar: string | null
}

export type ChaseRollRow = { kind: 'hide' | 'scout' | 'cross'; parties: string; found: string | null; die: number; score: number; DL: number; degree: string }

export type ChasePanel = {
  tiers: readonly ChaseTier[]
  // the fight parties, and whether each is running away
  parties: { id: string; name: string; quarry: boolean }[]
  chasing: boolean
  rows: ChasePartyRow[]
  // combat.tex "Chain order of running": who declares, head first
  order: string[]
  resolveBar: string | null
  resolved: boolean
  rolls: ChaseRollRow[]
  // combat.tex "Escape": the fight played out before anyone runs
  fightFirst: string | null
  // why the chase cannot be ended now
  endBar: string | null
  // what the table does next
  next: string | null
  // where the tokens go when a fight starts or someone arrives at one
  placement: string | null
  // why the round cannot end yet
  roundBar: string | null
  moves: readonly ChaseMove[]
  crossingSkills: typeof CROSSING_SKILLS
  // combat.tex "Cover": everyone in the chase and the cover the table gives them
  covers: readonly ChaseCover[]
  runners: { id: string; name: string; team: ChaseSide; cover: ChaseCover | null }[]
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

function getStatus(state: SceneState, id: string): string {
  const chase = state.chase!
  if (chase.out.includes(id)) return 'out of the chase'
  if (chase.fighting.includes(id)) return 'caught, fighting'
  if (chase.joining[id]) return `on the way to the fight of ${partyName(state, chase.joining[id])}`
  if (isDisconnected(state, id)) return 'disconnected: out when the round ends'
  if (isFrozen(state, id)) return 'keeping the distance at far range'
  const stage = getChaseStage(state, id)
  if (stage && stage !== 'deciding') return stage
  return getDeclarers(state).includes(id) ? 'deciding' : 'waiting on others'
}

function buildRun(state: SceneState, id: string): ChaseRunRow | null {
  const link = state.chase!.links[id]
  const run = link?.run
  if (!run) return null
  return {
    tier: run.tier,
    chaser: run.chaser,
    chased: run.chased,
    contest: run.contest,
    winner: run.winner,
    coin: run.coin,
    way: run.way,
    skirmish: run.skirmish,
    runners: Object.entries(run.speeds).map(([cid, speed]) => {
      const role: ChaseRole = state.partyOf[cid] === id ? 'chaser' : 'chased'
      return { id: cid, name: getFightName(state, cid), role, speed, slowest: speed === (role === 'chaser' ? run.chaser : run.chased) }
    }),
  }
}

const probe = (move: ChaseMove): ChaseDeclaration => ({ move, scout: null, hideModifier: 0 })

function buildRow(state: SceneState, id: string): ChasePartyRow {
  const chase = state.chase!
  const link = getLink(state, id)
  const others = Object.keys(state.parties).filter((p) => p !== id)
  const feature = chase.features[id]
  return {
    id,
    name: partyName(state, id),
    team: getTeam(chase, id),
    status: getStatus(state, id),
    out: chase.out.includes(id),
    fighting: chase.fighting.includes(id),
    chases: link && { name: partyName(state, link.chases), tier: link.tier, enemy: isEnemyLink(state, id), frozen: isFrozen(state, id) },
    chasedBy: getChasers(state, id).map((p) => partyName(state, p)),
    members: getMembers(state, id).map((c) => ({ id: c.id, name: getFightName(state, c.id), turned: chase.turned.includes(c.id) })),
    turnable: getMembers(state, id).some((c) => canTurnAround(state, c.id)),
    caught: getCaught(state, id).map((c) => c.reason),
    declares: getDeclarers(state).includes(id),
    declaration: chase.declarations[id] ?? null,
    moves: CHASE_MOVES.map((move) => ({ move, bar: getDeclareBar(state, id, probe(move)) })),
    scoutBar: getDeclareBar(state, id, { move: 'run', scout: { what: '', DL: 0, obstacle: false }, hideModifier: 0 }),
    run: buildRun(state, id),
    AP: getSkirmishAP(state, id),
    feature: feature ? { what: feature.what, tier: feature.tier, obstacle: feature.obstacle, reached: feature.reached } : null,
    crossBar: getObstacleOwner(state, id) ? getCrossBar(state, id) : null,
    followOptions: chase.out.includes(id) ? [] : others.filter((p) => !chase.out.includes(p) && link?.chases !== p).map((p) => ({ id: p, name: partyName(state, p), bar: getFollowBar(state, id, p) })),
    putBackOptions: chase.out.includes(id) ? others.filter((p) => !chase.out.includes(p)).map((p) => ({ id: p, name: partyName(state, p), bar: getPutBackBar(state, id, p) })) : [],
    joinOptions: chase.joining[id] || chase.fighting.includes(id) ? [] : chase.fighting.filter((p) => p !== id && state.parties[p]).map((p) => ({ id: p, name: partyName(state, p), bar: getJoinBar(state, id, p) })),
    joining: chase.joining[id] ? partyName(state, chase.joining[id]) : null,
    mergeBar: link && !isEnemyLink(state, id) ? getMergeBar(state, id) : null,
    giveUpBar: link ? getFightBusy(state) : null,
    fightBar: getFightBar(state, id, !chase.fighting.includes(id)),
  }
}

// What the table does next, in the order a chase round goes: declare head
// to tail, resolve, play out the turns, the next round.
function getNext(state: SceneState): string | null {
  const chase = state.chase
  if (!chase) return 'tick the parties running away, pick how far apart they start, and start the chase'
  if (state.round === 0) return 'press start combat to begin the first round'
  const first = getFightFirst(state)
  if (first) return `${first}: fight it out, then have them run again or end the chase`
  const endRound = 'everyone ends their turn and agrees to end the round, then next round'
  if (chase.resolved) {
    const stages = getChaseParties(state).map((p) => getChaseStage(state, p))
    const routing = stages.includes('routing')
    const skirmish = stages.includes('skirmish')
    if (routing) return `routing: everyone takes turns with their AP, the chasers at +2; ${endRound}`
    if (skirmish) return `skirmish: everyone takes turns with the AP shown; ${endRound}`
    return endRound
  }
  const caught = getChaseParties(state).filter((p) => getCaught(state, p).length > 0)
  if (caught.length) return `${caught.map((p) => partyName(state, p)).join(', ')} caught: start the fight, or untick whoever turned around`
  const bar = getResolveBar(state)
  if (bar?.startsWith('still to declare')) return `declare head to tail (the chased first, then whoever chases them), change it if you must, then resolve`
  return bar ?? 'resolve the round'
}

// combat.tex "Catching", "Combat with split group": where the tokens go.
function getPlacement(state: SceneState): string | null {
  const chase = state.chase
  if (!chase) return null
  const notes = [
    chase.fighting.length ? 'caught: the one who ended the chase within 10 m of an enemy and 20 m of every teammate, teams on either side of a semicircle around them, the chasers placing first; a grapple starts adjacent' : null,
    Object.keys(chase.joining).length ? 'arriving: no closer than 50 m to any enemy' : null,
  ].filter((n) => n)
  return notes.length ? notes.join('; ') : null
}

function buildChasePanel(state: SceneState): ChasePanel {
  const chase = state.chase
  const parties = chase ? Object.keys(state.parties) : []
  const named = (ids: string[]) => ids.map((p) => partyName(state, p)).join(', ')
  return {
    tiers: CHASE_TIERS,
    parties: Object.entries(state.parties).map(([id, p]) => ({ id, name: p.name || 'no name', quarry: !!chase?.runaways.includes(id) })),
    chasing: chase !== null,
    rows: parties.map((p) => buildRow(state, p)),
    order: chase ? getDeclareOrder(state).map((p) => partyName(state, p)) : [],
    resolveBar: chase ? getResolveBar(state) : null,
    resolved: !!chase?.resolved,
    rolls: chase?.rolls.map((r) => ({ kind: r.kind, parties: named(r.parties), found: r.found && partyName(state, r.found), ...r.roll })) ?? [],
    fightFirst: chase ? getFightFirst(state) : null,
    endBar: getFightBusy(state),
    next: getNext(state),
    placement: getPlacement(state),
    roundBar: chase && state.round > 0 ? getNextRoundNote(state) : null,
    moves: CHASE_MOVES,
    crossingSkills: CROSSING_SKILLS,
    covers: CHASE_COVERS,
    runners: chase ? Object.values(state.characters).filter((c) => getMembers(state, state.partyOf[c.id] ?? '').includes(c)).map((c) => ({ id: c.id, name: getFightName(state, c.id), team: getTeam(chase, state.partyOf[c.id]), cover: chase.cover[c.id] ?? null })) : [],
    elapsed: clock(state.elapsed),
    roundTakes: clock(getRoundSeconds(state)),
  }
}

export const getChasePanel = perState(buildChasePanel)
export const getChaseDigest = perState((state: SceneState) => JSON.stringify(getChasePanel(state)))
