import type { ChaseDeclaration, SceneState } from '../types'
import { CHASE_COVERS, CHASE_MOVES, CHASE_TIERS, CROSSING_SKILLS, type ChaseCover, type ChaseMove, type ChaseRole, type ChaseSide, type ChaseStage, type ChaseTier, type ChaseWay } from '../../lists'
import { perState } from '../../perState'
import { getFightName, getMembers, getPartyName } from '../rules/fighters'
import { getFightBusy } from '../rules/turn'
import { getNextRoundNote } from './turn'
import { getRoundPhase } from '../rules/roundChange'
import { isParkedParty } from '../rules/parked'
import { canTurnAround, getCaught, getChaseIntentBar, getChasers, getChaseParties, getChaseStartBar, getStartCaught, getChaseStage, getPartyTierBetween, getWant, newChase, getConfirmBar, getCrossBar, getDeclareBar, getDeclareOrder, getDeclarers, getFightBar, getFightFirst, getFollowBar, getJoinBar, getLink, getMergeBar, getObstacleOwner, getPutBackBar, getResolveBar, getRoundSeconds, getSkirmishAP, getTeam, isDisconnected, isEnemyLink, isFrozen } from '../rules/chase'

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
  confirmed: boolean
  confirmBar: string | null
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

// A party at the round change's chase step (combat.tex "Escape"): what it
// chose, whether it may run away or give chase and to whom, and whoever of it
// the chase would catch at once, to be left behind for it to start.
export type ChaseSetupRow = {
  id: string
  name: string
  intent: 'run' | 'chase' | null
  target: string
  tier: ChaseTier
  runBar: string | null
  chaseBar: string | null
  targets: { id: string; name: string }[]
  caught: string[]
  // who would stay behind, by name, null when nobody has to
  leaveBehind: string | null
}

export type ChaseSetup = { rows: ChaseSetupRow[]; startBar: string | null }

function getSetup(state: SceneState): ChaseSetup | null {
  if (state.chase || getRoundPhase(state) !== 'chase') return null
  const parties = Object.keys(state.parties).filter((p) => !isParkedParty(state, p) && getMembers(state, p).length > 0)
  const running = parties.filter((p) => state.chaseIntents[p]?.kind === 'run')
  return {
    startBar: getChaseStartBar(state),
    rows: parties.map((id) => {
      const intent = state.chaseIntents[id] ?? null
      const targets = running.filter((p) => p !== id).map((p) => ({ id: p, name: getPartyName(state, p) }))
      const caught = getStartCaught(state, id)
      return {
        id,
        name: getPartyName(state, id),
        intent: intent?.kind ?? null,
        target: intent?.kind === 'chase' ? intent.target : '',
        tier: intent?.kind === 'chase' ? intent.tier : 'combat',
        runBar: getChaseIntentBar(state, id, { kind: 'run' }),
        chaseBar: targets.length ? getChaseIntentBar(state, id, { kind: 'chase', target: targets[0].id, tier: 'combat' }) : 'nobody is running away',
        targets,
        caught: caught.map((c) => c.reason),
        leaveBehind: caught.length ? caught.map((c) => getFightName(state, c.id)).join(', ') : null,
      }
    }),
  }
}

export type ChasePanel = {
  tiers: readonly ChaseTier[]
  // the round change's chase step, null anywhere else
  setup: ChaseSetup | null
  chasing: boolean
  rows: ChasePartyRow[]
  // combat.tex "Chain order of running": who declares, head first
  order: string[]
  resolveBar: string | null
  resolved: boolean
  rolls: ChaseRollRow[]
  // combat.tex "Escape": the fight played out before anyone runs
  fightFirst: string | null
  // whether the board is played on: with no chase, or while a fight a catch
  // started is played out first
  boardInPlay: boolean
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


function getStatus(state: SceneState, id: string): string {
  const chase = state.chase!
  if (chase.out.includes(id)) return 'out of the chase'
  if (chase.fighting.includes(id)) return 'caught, fighting'
  if (chase.joining[id]) return `on the way to the fight of ${getPartyName(state, chase.joining[id])}`
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
    name: getPartyName(state, id),
    team: getTeam(chase, id),
    status: getStatus(state, id),
    out: chase.out.includes(id),
    fighting: chase.fighting.includes(id),
    chases: link && { name: getPartyName(state, link.chases), tier: link.tier, enemy: isEnemyLink(state, id), frozen: isFrozen(state, id) },
    chasedBy: getChasers(state, id).map((p) => getPartyName(state, p)),
    members: getMembers(state, id).map((c) => ({ id: c.id, name: getFightName(state, c.id), turned: chase.turned.includes(c.id) })),
    turnable: getMembers(state, id).some((c) => canTurnAround(state, c.id)),
    caught: getCaught(state, id).map((c) => c.reason),
    declares: getDeclarers(state).includes(id),
    declaration: chase.declarations[id] ?? null,
    confirmed: chase.confirmed.includes(id),
    confirmBar: getConfirmBar(state, id),
    moves: CHASE_MOVES.map((move) => ({ move, bar: getDeclareBar(state, id, probe(move)) })),
    scoutBar: getDeclareBar(state, id, { move: 'run', scout: { what: '', DL: 0, obstacle: false }, hideModifier: 0 }),
    run: buildRun(state, id),
    AP: getSkirmishAP(state, id),
    feature: feature ? { what: feature.what, tier: feature.tier, obstacle: feature.obstacle, reached: feature.reached } : null,
    crossBar: getObstacleOwner(state, id) ? getCrossBar(state, id) : null,
    followOptions: chase.out.includes(id) ? [] : others.filter((p) => !chase.out.includes(p) && link?.chases !== p).map((p) => ({ id: p, name: getPartyName(state, p), bar: getFollowBar(state, id, p) })),
    putBackOptions: chase.out.includes(id) ? others.filter((p) => !chase.out.includes(p)).map((p) => ({ id: p, name: getPartyName(state, p), bar: getPutBackBar(state, id, p) })) : [],
    joinOptions: chase.joining[id] || chase.fighting.includes(id) ? [] : chase.fighting.filter((p) => p !== id && state.parties[p]).map((p) => ({ id: p, name: getPartyName(state, p), bar: getJoinBar(state, id, p) })),
    joining: chase.joining[id] ? getPartyName(state, chase.joining[id]) : null,
    mergeBar: link && !isEnemyLink(state, id) ? getMergeBar(state, id) : null,
    giveUpBar: link ? getFightBusy(state) : null,
    fightBar: getFightBar(state, id, !chase.fighting.includes(id)),
  }
}

// What the table does next, in the order a chase round goes: declare head
// to tail, resolve, play out the turns, the next round.
function getNext(state: SceneState): string | null {
  const chase = state.chase
  if (!chase) return 'each party chooses to run away, to give chase, or neither; the chase starts with the round'
  if (state.round === 0) return 'press start combat to begin the first round'
  const first = getFightFirst(state)
  if (first) return `${first}: fight it out, then have them run again`
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
  if (caught.length) return `${caught.map((p) => getPartyName(state, p)).join(', ')} caught: start the fight, or untick whoever turned around`
  const bar = getResolveBar(state)
  if (bar?.startsWith('still to declare')) return 'declare head to tail: the chased first, then whoever chases them'
  if (bar?.startsWith('still to confirm')) return 'confirm tail to head, changing what was declared if you must: the last chaser first, the head of the chain last; then resolve'
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
  const named = (ids: string[]) => ids.map((p) => getPartyName(state, p)).join(', ')
  return {
    tiers: CHASE_TIERS,
    setup: getSetup(state),
    chasing: chase !== null,
    rows: parties.map((p) => buildRow(state, p)),
    order: chase ? getDeclareOrder(state).map((p) => getPartyName(state, p)) : [],
    resolveBar: chase ? getResolveBar(state) : null,
    resolved: !!chase?.resolved,
    rolls: chase?.rolls.map((r) => ({ kind: r.kind, parties: named(r.parties), found: r.found && getPartyName(state, r.found), ...r.roll })) ?? [],
    fightFirst: chase ? getFightFirst(state) : null,
    boardInPlay: !chase || getFightFirst(state) !== null,
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

// A member of a party on the chase track, with what marks them: turned
// around, in cover, or unable to run.
export type TrackToken = { id: string; name: string; short: string; marks: string[]; caught: boolean }

export type TrackParty = {
  id: string
  name: string
  team: ChaseSide
  stage: ChaseStage | null
  hiding: boolean
  fighting: boolean
  // the party whose fight it is on its way to, by name
  joining: string | null
  tokens: TrackToken[]
  // members past the tokens drawn
  more: number
  // the tier from this party to each other on the track, by id
  tiers: Record<string, ChaseTier | null>
}

// What one end of a link means to do this round: close in or pull away, or
// stand and shoot or hide; null while it has not declared.
export type TrackIntent = ChaseWay | 'shoot' | 'hide' | null

// A link on the chase track, the chaser on the left: its tier and the tier it
// was run at, its length step (1 for combat up to 4 for horizon), whether it
// joins enemies, whether it is frozen, what each end declared and, once
// resolved, the way it went and who won the contest.
export type TrackGap = {
  tier: ChaseTier
  was: ChaseTier | null
  step: number
  enemy: boolean
  frozen: boolean
  chaser: TrackIntent
  chased: TrackIntent
  way: ChaseWay | null
  winner: ChaseRole | null
}

export type TrackItem = { kind: 'party'; party: TrackParty } | { kind: 'gap'; gap: TrackGap } | { kind: 'join'; id: string; name: string }

// combat.tex "Group chases": the chain drawn as lanes, tail on the left and
// head on the right. The first lane runs from a tail to the head; a lane that
// branches off ends where it joins a party already drawn.
export type ChaseTrack = { lanes: TrackItem[][]; resolved: boolean; preview: boolean }

export const TRACK_TOKENS = 6

// A name cut to what fits on a token: the first letters of its first and
// last words (split at spaces and capitals), a number kept whole, or the
// first two letters of a single word.
function getShortName(name: string): string {
  const words = name.match(/\d+|[A-Z]?[a-z]+|[A-Z]+(?![a-z])/g) ?? [name]
  if (words.length === 1) return words[0].slice(0, 2)
  const last = words[words.length - 1]
  return `${words[0][0].toUpperCase()}${/^\d+$/.test(last) ? last : last[0].toUpperCase()}`
}

function getIntent(state: SceneState, partyId: string, role: ChaseRole): TrackIntent {
  const move = state.chase?.declarations[partyId]?.move
  return move === 'shoot' || move === 'hide' ? move : getWant(move, role)
}

function buildTrackParty(state: SceneState, id: string, parties: string[]): TrackParty {
  const chase = state.chase!
  const caught = getCaught(state, id)
  const members = getMembers(state, id)
  return {
    id,
    name: getPartyName(state, id),
    team: getTeam(chase, id),
    stage: getChaseStage(state, id),
    hiding: chase.declarations[id]?.move === 'hide',
    fighting: chase.fighting.includes(id),
    joining: chase.joining[id] ? getPartyName(state, chase.joining[id]) : null,
    tokens: members.slice(0, TRACK_TOKENS).map((c) => {
      const reason = caught.find((x) => x.id === c.id)?.reason
      const cover = chase.cover[c.id]
      return {
        id: c.id,
        name: getFightName(state, c.id),
        short: getShortName(getFightName(state, c.id)),
        marks: [chase.turned.includes(c.id) ? 'turned around' : null, cover ? `${cover} cover` : null, reason ?? null].filter((m) => m !== null),
        caught: reason !== undefined,
      }
    }),
    more: Math.max(0, members.length - TRACK_TOKENS),
    tiers: Object.fromEntries(parties.filter((p) => p !== id).map((p) => [p, getPartyTierBetween(state, id, p)])),
  }
}

function buildTrackGap(state: SceneState, from: string): TrackGap {
  const link = getLink(state, from)!
  const resolved = !!state.chase?.resolved && link.run !== null
  return {
    tier: link.tier,
    was: resolved && link.run!.tier !== link.tier ? link.run!.tier : null,
    step: CHASE_TIERS.indexOf(link.tier) + 1,
    enemy: isEnemyLink(state, from),
    frozen: isFrozen(state, from),
    chaser: getIntent(state, from, 'chaser'),
    chased: getIntent(state, link.chases, 'chased'),
    way: resolved ? link.run!.way : null,
    winner: resolved ? link.run!.winner : null,
  }
}

function buildTrack(state: SceneState, preview: boolean): ChaseTrack | null {
  if (!state.chase) return null
  const parties = getChaseParties(state).filter((p) => getMembers(state, p).length > 0 && !isDisconnected(state, p))
  const tails = parties.filter((p) => getChasers(state, p).length === 0)
  const drawn = new Set<string>()
  const lanes = tails.map((tail) => {
    const lane: TrackItem[] = []
    for (let at: string | undefined = tail; at !== undefined; at = getLink(state, at)?.chases) {
      if (drawn.has(at)) {
        lane.push({ kind: 'join', id: at, name: getPartyName(state, at) })
        break
      }
      drawn.add(at)
      lane.push({ kind: 'party', party: buildTrackParty(state, at, parties) })
      if (getLink(state, at)) lane.push({ kind: 'gap', gap: buildTrackGap(state, at) })
    }
    return lane
  })
  return { lanes: lanes.filter((l) => l.length > 0), resolved: state.chase.resolved, preview }
}

export const getChaseTrack = perState((state: SceneState) => buildTrack(state, false))

// At the round change's chase step, the chain the parties' choices would
// start, drawn the same way; null while nobody chose.
export const getChaseTrackPreview = perState((state: SceneState) => {
  if (state.chase || getRoundPhase(state) !== 'chase' || Object.keys(state.chaseIntents).length === 0) return null
  return buildTrack({ ...state, chase: newChase(state, state.chaseIntents) }, true)
})

export const getChaseTrackDigest = perState((state: SceneState) => JSON.stringify([getChaseTrack(state), getChaseTrackPreview(state)]))
