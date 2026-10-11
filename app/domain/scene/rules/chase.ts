import type { CampaignCharacter } from '../../types'
import type { Chase, ChaseGroup, SceneState } from '../types'
import type { Term } from '../../character/rules/terms'
import { AFFLICTIONS, CHASE_JOIN_MAX_ROUNDS, CHASE_PARTIAL_COVER_REFLEX, CHASE_ROUND_SECONDS, CHASE_TIER_METRES, ROUND_AP, ROUND_SECONDS, SKIRMISH_APPROACH_AP, SKIRMISH_SECONDS, SKIRMISH_SHOOT_AP, SKIRMISH_SHOOTER_AP, SURGES } from '../../tables'
import { CHASE_TIERS, SHOT_RANGES, type ChaseSide, type ChaseTier, type SkirmishStance } from '../../lists'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getAGI, getSTA } from '../../character/rules/characteristics'
import { getRunMovement } from '../../character/rules/movement'
import { getSurgeAP } from '../../character/rules/surge'
import { getSituationalAfflictions } from './situational'
import { getFightName } from './fighters'
import { getFightBusy } from './turn'

export type ChaseWay = 'close' | 'open'

// A chase the parties named start running away in, at the tier the table
// sets ("Approach": "The weapon range will decide at what distance both
// teams start").
export function newChase(quarry: string[], tier: ChaseTier): Chase {
  return { groups: Object.fromEntries(quarry.map((g) => [g, { tier, escaped: false, fighting: false, unfollowed: 0, run: null }])), follows: {}, joining: {}, turned: [], stances: {}, cover: {} }
}

// The side a character runs on: whoever is in a group running away is the
// quarry, everyone else gives chase.
export function getChaseSide(state: SceneState, id: string): ChaseSide {
  return state.chase?.groups[state.partyOf[id] ?? ''] ? 'quarry' : 'pursuers'
}

// The groups running away that are still in the fight.
export function getQuarryGroups(state: SceneState): string[] {
  return Object.keys(state.chase?.groups ?? {}).filter((g) => state.parties[g])
}

// The parties giving chase.
export function getPursuerParties(state: SceneState): string[] {
  return state.chase ? Object.keys(state.parties).filter((p) => !state.chase!.groups[p]) : []
}

// Everyone in the party still alive.
export function getMembers(state: SceneState, partyId: string): CampaignCharacter[] {
  return Object.values(state.characters).filter((c) => !isDead(c) && state.partyOf[c.id] === partyId)
}

// Who runs for the side: everyone on it still alive.
export function getRunners(state: SceneState, side: ChaseSide): CampaignCharacter[] {
  return Object.values(state.characters).filter((c) => !isDead(c) && getChaseSide(state, c.id) === side)
}

// The group a pursuing party follows: the one the table picked, or, while
// only one group is still running, that one.
export function getFollowed(state: SceneState, partyId: string): string | null {
  const chase = state.chase
  if (!chase || chase.groups[partyId]) return null
  const running = getQuarryGroups(state).filter((g) => !chase.groups[g].escaped)
  const picked = chase.follows[partyId]
  if (picked && running.includes(picked)) return picked
  return running.length === 1 ? running[0] : null
}

// The parties following the group.
export function getFollowers(state: SceneState, group: string): string[] {
  return getPursuerParties(state).filter((p) => getFollowed(state, p) === group)
}

// The group a party's chase is about: its own, if it runs away, or the one
// it follows.
export function getPairGroup(state: SceneState, partyId: string): string | null {
  return state.chase?.groups[partyId] && state.parties[partyId] ? partyId : getFollowed(state, partyId)
}

// The group's pair: the group and the parties following it.
function getPairParties(state: SceneState, group: string): string[] {
  return [group, ...getFollowers(state, group)]
}

// combat.tex "Running": at combat range a dash, "Whoever has the highest AGI
// x running speed wins"; at longer ranges a sustained pace, "The running
// speed is STA + AGI" — the STA attribute, every penalty on both counted.
export function getRunSpeed(c: CampaignCharacter, tier: ChaseTier): number {
  return tier === 'combat' ? getAGI(c) * getRunMovement(c) : getSTA(c) + getAGI(c)
}

// combat.tex "Group chase": "use the speeds of the slowest in each group".
export function getSideSpeed(runners: CampaignCharacter[], tier: ChaseTier): number {
  return Math.min(...runners.map((c) => getRunSpeed(c, tier)))
}

// combat.tex "Catching": "The quarry is caught when one of its members does
// not have STA to run, when they decide to turn around and face the pursuer,
// or when it ends a round with any mobility affliction while in combat range"
// — lacking STA only in combat range too, where running is a dash on the
// movement surge's STA. Each member of the group who would end its run, and
// why.
export function getCaught(state: SceneState, group: string): { id: string; reason: string }[] {
  const chase = state.chase
  const g = chase?.groups[group]
  if (!chase || !g || g.escaped || g.fighting) return []
  return getMembers(state, group).flatMap((c) => {
    const name = getFightName(state, c.id)
    if (chase.turned.includes(c.id)) return [{ id: c.id, reason: `${name} turned around` }]
    if (g.tier !== 'combat') return []
    if (c.resources.STA < SURGES.movement.STA) return [{ id: c.id, reason: `${name} has no STA to run` }]
    const hobbled = getAfflictions(c, getSituationalAfflictions(state, c.id)).find((k) => AFFLICTIONS[k].category === 'mobility')
    return hobbled ? [{ id: c.id, reason: `${name} is ${hobbled}` }] : []
  })
}

// combat.tex "Escape": "The chase starts when everyone in a party decides to
// run away [...]. It always starts at the beginning of a new round. Any
// character that cannot run for whatever reason at the beginning of the
// round will prevent the chase from beginning" — whoever the chase would
// catch at once.
export function getChaseStartBar(state: SceneState, quarry: string[], tier: ChaseTier): string | null {
  if (state.chase) return 'a chase is under way'
  const busy = getFightBusy(state)
  if (busy) return busy
  if (state.turnsTaken.length > 0) return 'a chase starts at the beginning of a round'
  const started = { ...state, chase: newChase(quarry, tier) }
  if (getRunners(started, 'quarry').length === 0 || getRunners(started, 'pursuers').length === 0) return 'a chase needs someone on each side'
  const caught = quarry.flatMap((g) => getCaught(started, g))
  return caught.length ? `cannot run: ${caught.map((c) => c.reason).join(', ')}` : null
}

// combat.tex "Escape": "finish the fight, and then start the chase" — while
// a group is caught and fighting, the fight is played out before anyone runs.
export function getFightFirst(state: SceneState): string | null {
  const chase = state.chase
  const fighting = getQuarryGroups(state).filter((g) => chase!.groups[g].fighting && getMembers(state, g).length > 0)
  return fighting.length ? `${fighting.map((g) => state.parties[g].name || 'a group').join(', ')} fighting first` : null
}

function getGroupBar(state: SceneState, group: string): string | null {
  const g = state.chase?.groups[group]
  if (!state.chase) return 'there is no chase'
  if (!g || !state.parties[group]) return 'they are not running away'
  if (g.escaped) return 'they got away'
  if (g.fighting) return 'they are fighting'
  if (state.round === 0) return 'press start combat to begin the first round'
  return null
}

// Why the group's run cannot be made now: one a round, at its beginning,
// before anyone takes a turn, with both sides of the pair on their feet and
// no fight to finish first.
export function getRunBar(state: SceneState, group: string): string | null {
  const bar = getGroupBar(state, group)
  if (bar) return bar
  const chase = state.chase!
  if (chase.groups[group].run) return 'the round has been run'
  if (getPairParties(state, group).some((p) => chase.stances[p])) return 'a skirmish is being fought this round'
  const first = getFightFirst(state)
  if (first) return first
  const busy = getFightBusy(state)
  if (busy) return busy
  if (state.turnsTaken.length > 0) return 'the round is under way'
  const followers = getFollowers(state, group)
  if (followers.length === 0) return 'nobody follows them'
  if (getMembers(state, group).length === 0 || followers.every((p) => getMembers(state, p).length === 0)) return 'a side has nobody left to run'
  const caught = getCaught(state, group)
  return caught.length ? `caught: ${caught.map((c) => c.reason).join(', ')}` : null
}

// combat.tex "Running": "the fastest decides to close the distance or move
// away" — closing at combat range goes nowhere nearer.
export function getChaseWays(state: SceneState, group: string): ChaseWay[] {
  const g = state.chase?.groups[group]
  const run = g?.run
  if (!g || !run || run.chosen || run.winner === null) return []
  return g.tier === 'combat' ? ['open'] : ['close', 'open']
}

// combat.tex "Outrunning": "If the distance is already far or Horizon and the
// winner decides to increase the distance, the chase is over."
export function isOutrun(tier: ChaseTier, way: ChaseWay): boolean {
  return way === 'open' && (tier === 'far' || tier === 'horizon')
}

// One tier nearer or farther.
export function stepTier(tier: ChaseTier, way: ChaseWay): ChaseTier {
  return CHASE_TIERS[CHASE_TIERS.indexOf(tier) + (way === 'open' ? 1 : -1)]
}

// A group nobody follows keeps its tier for a round, then pulls away a tier
// each round, and is gone once it reaches far (the table's ruling).
export function getUnfollowedStep(g: ChaseGroup): Pick<ChaseGroup, 'tier' | 'escaped'> {
  if (g.unfollowed < 1) return { tier: g.tier, escaped: false }
  const next = Math.min(CHASE_TIERS.indexOf(g.tier) + 1, CHASE_TIERS.length - 1)
  return { tier: CHASE_TIERS[next], escaped: next >= CHASE_TIERS.indexOf('far') }
}

// How long the round took: a fight's round while one is being played out,
// else the shortest of the chases under way — a skirmish's, or a run's by
// the tier it was run at (or stands at, if it was not run).
export function getRoundSeconds(state: SceneState): number {
  const chase = state.chase
  if (!chase || getFightFirst(state)) return ROUND_SECONDS
  const running = getQuarryGroups(state).filter((g) => !chase.groups[g].escaped && getFollowers(state, g).length > 0)
  const seconds = running.map((g) => getPairParties(state, g).some((p) => chase.stances[p]) ? SKIRMISH_SECONDS : CHASE_ROUND_SECONDS[chase.groups[g].run?.tier ?? chase.groups[g].tier])
  return seconds.length ? Math.min(...seconds) : ROUND_SECONDS
}

// The tier between two characters on opposite sides of a chase: the
// group's, as seen from whoever follows it (the simple version: whichever
// pursuer is asking); null within a side or with no chase.
export function getChaseTierBetween(state: SceneState, a: string, b: string): ChaseTier | null {
  const chase = state.chase
  if (!chase || getChaseSide(state, a) === getChaseSide(state, b)) return null
  const group = chase.groups[state.partyOf[getChaseSide(state, a) === 'quarry' ? a : b] ?? '']
  return group?.tier ?? null
}

// combat.tex "Routing": in combat range "the pursuers have +2 bonus to all
// uses of strike, accuracy and cunning" — while the group they follow is not
// yet caught.
export function getRoutingTerms(state: SceneState, id: string): Term[] {
  const chase = state.chase
  if (!chase || getChaseSide(state, id) !== 'pursuers') return []
  const followed = getFollowed(state, state.partyOf[id] ?? '')
  const g = followed ? chase.groups[followed] : null
  return g && !g.escaped && !g.fighting && g.tier === 'combat' ? [{ label: 'routing', value: 2 }] : []
}

// The metres between two characters on opposite sides of a chase past combat
// range; null for everyone else, whose distance is the board's, if any.
export function getChaseDistance(state: SceneState, a: string, b: string): number | null {
  const tier = getChaseTierBetween(state, a, b)
  return tier && tier !== 'combat' ? CHASE_TIER_METRES[tier] : null
}

// combat.tex "Approach": a shot's range names a tier, and reaches a side as
// far as that tier.
export function reachesTier(range: string, tier: ChaseTier): boolean {
  return (SHOT_RANGES as readonly string[]).includes(range) && CHASE_TIERS.indexOf(range as ChaseTier) >= CHASE_TIERS.indexOf(tier)
}

// combat.tex "Cover": "If a character has cover, they can decide not to
// leave it and stay untargetable, but then they cannot target any enemy" —
// whether either of the two stays in cover from the other's side.
export function isSheltered(state: SceneState, a: string, b: string): boolean {
  const cover = state.chase?.cover ?? {}
  return getChaseSide(state, a) !== getChaseSide(state, b) && (cover[a] === 'total' || cover[b] === 'total')
}

// combat.tex "Cover": partial cover's bonus to the character's reflexes.
export function getChaseCoverTerms(state: SceneState, id: string): Term[] {
  return state.chase?.cover[id] === 'partial' ? [{ label: 'cover', value: CHASE_PARTIAL_COVER_REFLEX }] : []
}

// combat.tex "Skirmish", chosen at the beginning of the round in place of
// running, at shooting range — and far, for whoever reaches it (the table's
// ruling); each party's stance once, the pair's run not made.
export function getStanceBar(state: SceneState, partyId: string): string | null {
  const group = getPairGroup(state, partyId)
  if (!state.chase) return 'there is no chase'
  if (!group) return 'they follow nobody'
  const tier = state.chase.groups[group].tier
  if (tier !== 'shooting' && tier !== 'far') return 'a skirmish is fought only at shooting or far range'
  if (state.chase.stances[partyId]) return 'they have chosen'
  const bar = getRunBar(state, group)
  return bar === 'a skirmish is being fought this round' ? null : bar
}

// The parties the party skirmishes against: the followers of its group, or
// the group it follows.
function getOpponents(state: SceneState, partyId: string): string[] {
  const group = getPairGroup(state, partyId)
  if (!group) return []
  return group === partyId ? getFollowers(state, group) : [group]
}

// combat.tex "Skirmish": the AP a party has for the round once it and those
// it skirmishes against have chosen — 12 when both shoot; 8 for whoever
// approaches, and for the shooters what the slowest approacher's running
// speed leaves them.
export function getSkirmishAP(state: SceneState, partyId: string): number | null {
  const stances = state.chase?.stances ?? {}
  const opponents = getOpponents(state, partyId)
  if (!stances[partyId] || opponents.length === 0 || opponents.some((p) => !stances[p])) return null
  if (stances[partyId] === 'approach') return SKIRMISH_APPROACH_AP
  const approachers = opponents.filter((p) => stances[p] === 'approach').flatMap((p) => getMembers(state, p))
  if (approachers.length === 0) return SKIRMISH_SHOOT_AP
  const slowest = Math.min(...approachers.map(getRunMovement))
  return SKIRMISH_SHOOTER_AP.find((row) => slowest >= row.speed)!.AP
}

// The round's AP traded for a skirmish's, keeping what was owed into it
// (combat.tex "End of the round": "reset to 8 AP minus any negative AP").
export function getSkirmishAPOf(c: CampaignCharacter, AP: number): number {
  return AP + c.resources.AP - ROUND_AP
}

// combat.tex "Skirmish": "At the end, both teams will be in combat range"
// when anyone approached — a tier nearer, from far (the table's ruling).
export function isClosingSkirmish(state: SceneState, group: string): boolean {
  const stances: Record<string, SkirmishStance> = state.chase?.stances ?? {}
  const pair = getPairParties(state, group)
  return pair.length > 1 && pair.every((p) => stances[p]) && pair.some((p) => stances[p] === 'approach')
}

// combat.tex "Separating the group": "If combat starts, the distant group
// takes 2 full rounds to arrive" — the rounds the party's slowest member
// needs to run shooting range's metres on a movement surge, at most 3.
export function getJoinRounds(state: SceneState, partyId: string): number {
  const metres = Math.min(...getMembers(state, partyId).map((c) => getSurgeAP('movement')(c) / 2 * getRunMovement(c)))
  return metres > 0 ? Math.min(CHASE_JOIN_MAX_ROUNDS, Math.ceil(CHASE_TIER_METRES.shooting / metres)) : CHASE_JOIN_MAX_ROUNDS
}

// Why the party cannot set off to join the fight the group is caught in: it
// must be at shooting range, not on its way already, nor fighting itself.
export function getJoinBar(state: SceneState, partyId: string, to: string): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (!chase.groups[to]?.fighting) return 'there is no fight there'
  if (partyId === to) return 'they are in that fight'
  if (chase.joining[partyId]) return 'they are on their way'
  const group = getPairGroup(state, partyId)
  const g = group ? chase.groups[group] : null
  if (!g || g.escaped) return 'they are out of the chase'
  if (group === partyId && g.fighting) return 'they are fighting'
  if (g.tier !== 'shooting') return 'only from shooting range'
  return getMembers(state, partyId).length ? null : 'nobody left in the party'
}

// Why the party cannot follow the group: it gives chase, the group still
// runs (a caught one is reached by joining its fight), and its own pair has
// not yet run or skirmished this round.
export function getFollowBar(state: SceneState, partyId: string, group: string): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (chase.groups[partyId]) return 'they are running away'
  const g = chase.groups[group]
  if (!g || !state.parties[group] || g.escaped) return 'that group is out of the chase'
  if (g.fighting) return 'join the fight instead'
  const current = getFollowed(state, partyId)
  if (current && (chase.groups[current].run || chase.stances[partyId])) return 'the round has been run'
  return getFightBusy(state)
}
